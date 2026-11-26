import type { Metadata } from 'next';
import './globals.css';
import {ChatSession} from '@/components/chat-state';
export const metadata:Metadata={title:'UrbanFlow · NYC Mobility Intelligence',description:'Explore NYC mobility research, official transit disruptions and transparent taxi fare estimates.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><ChatSession>{children}</ChatSession></body></html>;}
