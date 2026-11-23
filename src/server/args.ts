// Command-line parsing for the playground CLI.

const FLAGS = ['session', 'round', 'item', 'state', 'note', 'note-file', 'port', 'root', 'host', 'json'];
const isFlag = (a: string | undefined) => !!a && a.startsWith('--') && FLAGS.includes(a.slice(2));

export function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'note') {
        // Take every word up to the next flag: shells between Windows and WSL drop the quotes, so a
        // quoted note can arrive split into words.
        const words: string[] = [];
        while (i + 1 < argv.length && !isFlag(argv[i + 1])) words.push(argv[++i]);
        flags[key] = words.length ? words.join(' ') : true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}
