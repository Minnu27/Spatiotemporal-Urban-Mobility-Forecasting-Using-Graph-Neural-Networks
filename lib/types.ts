export type Incident = {
  id: string; source: 'NYC DOT' | 'MTA' | 'Citizen'; title: string; description: string;
  kind: 'road' | 'subway'; borough: string; severity: 'low' | 'moderate' | 'high';
  start: string | null; end: string | null; latitude: number | null; longitude: number | null;
  routes: string[]; url: string; fetchedAt: string;
};
export type FeedStatus = { source: string; state: 'live' | 'unavailable' | 'not_configured'; detail: string; fetchedAt: string };
export type AlertResult = { incidents: Incident[]; feeds: FeedStatus[]; fetchedAt: string };
export type Zone = { id: number; name: string; borough: string; latitude: number; longitude: number };
export type Impact = { zoneId: number; score: number; level: 'low' | 'moderate' | 'high'; incidentIds: string[]; explanation: string };
export type Forecast = { mode: 'unavailable' | 'historical' | 'live'; model: string | null; issuedAt: string; historySource: string | null; rows: { zoneId: number; horizon: number; value: number }[]; message: string };
export type Document = { id: string; title: string; text: string; url: string; kind: string };
