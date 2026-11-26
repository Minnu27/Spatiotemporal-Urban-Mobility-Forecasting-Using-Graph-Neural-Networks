'use client';
import {createContext,useContext,useState,type Dispatch,type SetStateAction,type ReactNode} from 'react';
import type {ChatReply} from '@/lib/chat-protocol';
export type ChatTurn={id:string;role:'user'|'assistant';body:string;reply?:ChatReply};
const Context=createContext<{turns:ChatTurn[];setTurns:Dispatch<SetStateAction<ChatTurn[]>>}|null>(null);
export function ChatSession({children}:{children:ReactNode}){
 const [turns,setTurns]=useState<ChatTurn[]>([]);
 return <Context.Provider value={{turns,setTurns}}>{children}</Context.Provider>;
}
export function useChatSession(){
 const session=useContext(Context);
 const [turns,setTurns]=useState<ChatTurn[]>([]);
 return session||{turns,setTurns};
}
