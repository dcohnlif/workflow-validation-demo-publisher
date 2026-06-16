const REPLACEMENTS: readonly [RegExp, string][] = [
  [/^Clicked\b/, 'Click'],
  [/^Typed\b/, 'Type'],
  [/^Filled form\b/, 'Fill form'],
  [/^Pressed key\b/, 'Press key'],
  [/^Navigated\b/, 'Navigate'],
  [/^Selected\b/, 'Select'],
  [/^Scrolled\b/, 'Scroll'],
  [/^Observed\b/, 'Observe'],
  [/^Hovered\b/, 'Hover'],
  [/^Waited\b/, 'Wait'],
];

export function toImperativeLabel(narrative: string): string {
  for (const [pattern, replacement] of REPLACEMENTS) {
    if (pattern.test(narrative)) {
      return narrative.replace(pattern, replacement);
    }
  }
  return narrative;
}
