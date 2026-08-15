import type { WhaleEffect } from './activity.ts';
import { WhalePetService } from './runtime/whale-pet-service.ts';
import type { WhalePetChat } from './runtime/whale-pet-chat.ts';
export interface WhalePetProps {
    whalePet: WhalePetService;
    /** Optional LLM chat coordinator; adds the "和鲸鲸聊天" menu entry. */
    whalePetChat?: WhalePetChat;
}
/** The frame-wide interactive whale pet surface (view only). */
export declare function WhalePet({ whalePet, whalePetChat }: WhalePetProps): React.ReactElement;
export type { WhaleEffect };
