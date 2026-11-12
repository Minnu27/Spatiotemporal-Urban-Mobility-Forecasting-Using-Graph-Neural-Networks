"""Notebook architectures extracted into importable, side-effect-free modules."""
import torch
from torch import nn
from torch.nn import functional as F

class NodeGRU(nn.Module):
    def __init__(self, n_nodes, n_ctx, hidden=64, emb=16, layers=2, horizon=6, dropout=0.1):
        super().__init__()
        self.emb = nn.Embedding(n_nodes, emb)
        self.gru = nn.GRU(1 + n_ctx + emb, hidden, layers, batch_first=True, dropout=dropout)
        self.head = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, horizon))

    def forward(self, x_dem, x_ctx):            # x_dem [B,T,N], x_ctx [B,T,F]
        B, T, N = x_dem.shape
        e = self.emb.weight[None, None].expand(B, T, N, -1)
        c = x_ctx[:, :, None, :].expand(B, T, N, -1)
        z = torch.cat([x_dem[..., None], c, e], dim=-1)          # [B,T,N,D]
        z = z.permute(0, 2, 1, 3).reshape(B * N, T, -1)          # each zone = one sequence
        out, _ = self.gru(z)
        y = self.head(out[:, -1])                                # [B*N, H]
        return y.view(B, N, -1).permute(0, 2, 1)

class GraphConv(nn.Module):
    """K-hop graph convolution: concatenates [X, AX, A²X, ...] then projects."""
    def __init__(self, d_in, d_out, A_hat, K=2):
        super().__init__()
        self.register_buffer("A", torch.tensor(A_hat, dtype=torch.float32))
        self.K = K
        self.lin = nn.Linear(d_in * (K + 1), d_out)

    def forward(self, x):                          # x [..., N, D]
        out, h = [x], x
        for _ in range(self.K):
            h = torch.einsum("nm,...md->...nd", self.A, h)
            out.append(h)
        return self.lin(torch.cat(out, dim=-1))

class GCNGRU(nn.Module):
    def __init__(self, n_nodes, n_ctx, A_hat, hidden=64, emb=16, layers=2,
                 horizon=6, dropout=0.1, K=2):
        super().__init__()
        self.emb = nn.Embedding(n_nodes, emb)
        self.inp = nn.Linear(1 + n_ctx + emb, hidden)
        self.gc_in = GraphConv(hidden, hidden, A_hat, K)       # spatial mixing per hour
        self.gru = nn.GRU(hidden, hidden, layers, batch_first=True, dropout=dropout)
        self.gc_out = GraphConv(hidden, hidden, A_hat, K)      # spatial mixing of temporal state
        self.norm = nn.LayerNorm(hidden)
        self.head = nn.Sequential(nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, horizon))

    def forward(self, x_dem, x_ctx):               # x_dem [B,T,N], x_ctx [B,T,F]
        B, T, N = x_dem.shape
        e = self.emb.weight[None, None].expand(B, T, N, -1)
        c = x_ctx[:, :, None, :].expand(B, T, N, -1)
        h = torch.relu(self.inp(torch.cat([x_dem[..., None], c, e], dim=-1)))   # [B,T,N,D]
        h = h + torch.relu(self.gc_in(h))
        h = h.permute(0, 2, 1, 3).reshape(B * N, T, -1)
        out, _ = self.gru(h)
        s = out[:, -1].view(B, N, -1)
        s = self.norm(s + torch.relu(self.gc_out(s)))
        return self.head(s).permute(0, 2, 1)

class DiffusionConv(nn.Module):
    def __init__(self, c_in, c_out, n_supports, order=2, dropout=0.3):
        super().__init__()
        self.order = order
        self.mlp = nn.Conv2d(c_in * (1 + order * n_supports), c_out, 1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x, supports):                # x [B,C,N,T]
        out = [x]
        for A in supports:
            x1 = torch.einsum("bcvt,wv->bcwt", x, A)
            out.append(x1)
            for _ in range(self.order - 1):
                x1 = torch.einsum("bcvt,wv->bcwt", x1, A)
                out.append(x1)
        return self.dropout(self.mlp(torch.cat(out, dim=1)))

class GraphWaveNet(nn.Module):
    def __init__(self, n_nodes, n_ctx, supports, adaptive=True, emb=16, res_ch=32,
                 dil_ch=32, skip_ch=128, end_ch=256, horizon=6, blocks=4, layers=2,
                 dropout=0.3, apt_dim=10):
        super().__init__()
        self.emb = nn.Embedding(n_nodes, emb)
        self.n_fixed = len(supports)
        for i, s in enumerate(supports):
            self.register_buffer(f"S{i}", torch.tensor(s, dtype=torch.float32))
        self.adaptive = adaptive
        if adaptive:
            self.nodevec1 = nn.Parameter(torch.randn(n_nodes, apt_dim) * 0.1)
            self.nodevec2 = nn.Parameter(torch.randn(apt_dim, n_nodes) * 0.1)
        n_sup = self.n_fixed + int(adaptive)

        self.start = nn.Conv2d(1 + n_ctx + emb, res_ch, 1)
        self.filt, self.gate, self.skip, self.gconv, self.bn = (nn.ModuleList() for _ in range(5))
        rf = 1
        for _ in range(blocks):
            d = 1
            for _ in range(layers):
                self.filt.append(nn.Conv2d(res_ch, dil_ch, (1, 2), dilation=(1, d)))
                self.gate.append(nn.Conv2d(res_ch, dil_ch, (1, 2), dilation=(1, d)))
                self.skip.append(nn.Conv2d(dil_ch, skip_ch, 1))
                self.gconv.append(DiffusionConv(dil_ch, res_ch, n_sup, dropout=dropout))
                self.bn.append(nn.BatchNorm2d(res_ch))
                rf += d
                d *= 2
        self.receptive_field = rf
        self.end1 = nn.Conv2d(skip_ch, end_ch, 1)
        self.end2 = nn.Conv2d(end_ch, horizon, 1)

    def adaptive_adj(self):
        return torch.softmax(torch.relu(self.nodevec1 @ self.nodevec2), dim=1)

    def forward(self, x_dem, x_ctx):               # x_dem [B,T,N], x_ctx [B,T,F]
        B, T, N = x_dem.shape
        e = self.emb.weight[None, None].expand(B, T, N, -1)
        c = x_ctx[:, :, None, :].expand(B, T, N, -1)
        x = torch.cat([x_dem[..., None], c, e], dim=-1).permute(0, 3, 2, 1)   # [B,D,N,T]
        if T < self.receptive_field:
            x = F.pad(x, (self.receptive_field - T, 0))
        supports = [getattr(self, f"S{i}") for i in range(self.n_fixed)]
        if self.adaptive:
            supports = supports + [self.adaptive_adj()]

        x = self.start(x)
        skip = None
        for i in range(len(self.filt)):
            res = x
            h = torch.tanh(self.filt[i](x)) * torch.sigmoid(self.gate[i](x))
            s = self.skip[i](h)
            skip = s if skip is None else s + skip[..., -s.size(3):]
            h = self.gconv[i](h, supports)
            x = self.bn[i](h + res[..., -h.size(3):])
        out = self.end2(torch.relu(self.end1(torch.relu(skip))))   # [B,H,N,1]
        return out[..., -1]
