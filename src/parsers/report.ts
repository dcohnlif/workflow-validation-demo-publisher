export interface ReportData {
  readonly title: string;
  readonly description: string;
  readonly sections: readonly { readonly title: string }[];
}

export function parseReportFile(content: string): ReportData {
  const lines = content.split('\n');

  // Title: first line matching "# " (strip the "# " prefix)
  let title = '';
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ') && !lines[i].startsWith('## ')) {
      title = lines[i].slice(2).trim();
      titleLineIdx = i;
      break;
    }
  }

  // Description: all text between title line and first "## " heading, trimmed
  let description = '';
  if (titleLineIdx >= 0) {
    const descLines: string[] = [];
    for (let i = titleLineIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) break;
      descLines.push(lines[i]);
    }
    description = descLines.join('\n').trim();
  }

  // Sections: all "## " headings, in order
  const sections: { readonly title: string }[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      sections.push({ title: line.slice(3).trim() });
    }
  }

  return { title, description, sections };
}
