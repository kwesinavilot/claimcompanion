export type SafetyResult = { level: 'none' | 'check_needed' | 'emergency'; guidance?: string };

// Conservative, deterministic check: ambiguous danger language pauses intake too.
// False positives can be clarified in a later call; no model runs on this path.
const danger = /\b(injur(?:y|ies|ed)|hurt(?:s|ing)?|bleed(?:s|ing)?|pain|dizzy|unconscious|trapped|fire|smoke|danger|unsafe|not safe|can't breathe|cannot breathe|ambulance|emergency|gas leak|fuel leak|broken arm|broken leg)\b/i;
export function checkSafety(narrative?: string, anyoneInjured?: boolean): SafetyResult {
  const text = narrative?.normalize('NFKC').replace(/’/g, "'")
    .replace(/\b(?:no one|nobody|none of us)\s+(?:(?:is|was|are|were)\s+)?(?:hurt|injured|bleeding)\b/gi, '')
    .replace(/\b(?:no injuries|not injured|not hurt|no fire)\b/gi, '');
  if (anyoneInjured === true || (text && danger.test(text))) {
    return { level: 'emergency', guidance: 'If anyone is hurt or in danger, call your local emergency number now. Continue only when everyone is safe.' };
  }
  if (anyoneInjured === undefined) return { level: 'check_needed', guidance: 'Is anyone hurt, or are you somewhere unsafe?' };
  return { level: 'none' };
}
