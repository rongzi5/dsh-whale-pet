import type { WhaleEffect } from './activity.ts';
import { WhalePetService } from './runtime/whale-pet-service.ts';
export interface WhalePetProps {
    whalePet: WhalePetService;
}
/** The frame-wide interactive whale pet surface (view only). */
export declare function WhalePet({ whalePet }: WhalePetProps): React.ReactElement;
export type { WhaleEffect };
