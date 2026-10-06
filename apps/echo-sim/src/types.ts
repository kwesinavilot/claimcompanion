export type Stage = 'safety' | 'consent' | 'intake' | 'review' | 'submitted' | 'emergency';
export interface Message { role: 'user' | 'assistant'; text: string }
export interface Trace { name: string; arguments: Record<string, unknown>; result: Record<string, unknown>; ms: number }
export interface Card { intakeId?: string; claimId?: string; details?: Record<string, unknown>; uploadUrl?: string }
export interface TurnResponse { text: string; continuation: string; stage: Stage; traces: Trace[]; card?: Card; mode: 'demo' | 'bedrock' }
export const sampleReport = 'Another car backed into my parked car. It happened on 2026-10-04T14:10:00Z at Oak Street. My plate is 7KBX294. Nobody was hurt and the car is drivable.';
