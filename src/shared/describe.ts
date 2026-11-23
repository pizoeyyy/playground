import type { Comment, Op, Round, Session } from './types.ts';
import { activeOps } from './session.ts';

const slideName = (s: Session, id: string) => {
  const sl = s.slides.find((x) => x.id === id);
  return sl ? `${id} "${sl.label}" (${sl.url})` : id;
};

export function describeOp(op: Op): string {
  const head = `[${op.id}] ${op.kind.toUpperCase()} ${op.element}  selector: ${op.selector}`;
  const lines = [head, `    ${op.label}`];
  if (op.kind === 'style' && op.prop) lines.push(`    ${op.prop}: ${op.before ?? '?'} -> ${op.after}`);
  if (op.kind === 'text') lines.push(`    text: ${JSON.stringify(op.before)} -> ${JSON.stringify(op.after)}`);
  if (op.kind === 'move') lines.push(`    dragged offset (a rough hint, not pixels to copy): ${op.after}`);
  if (op.kind === 'resize') lines.push(`    size was ${op.before}; dragged to ${op.after} (width height, auto = unchanged; a rough hint: express it with the layout)`);
  if (op.insert) {
    lines.push(`    new ${op.insert.kind ?? 'element'} ${op.insert.position === 'append' ? 'inside' : 'after'} ${op.insert.ref}:`);
    lines.push(`    ${op.insert.html}`);
    if (op.insert.kind)
      lines.push(`    the user placed a ${op.insert.kind}: build a real ${op.insert.kind} in the project's style. Don't swap it for another kind of control; suggest alternatives in the note.`);
    if (op.insert.float) lines.push(`    placed freely: it floats over the layout in the editor (absolute position is only the editor's). Put it into the real layout where it sits, aligned with its neighbours.`);
  }
  for (const n of op.neighbours ?? []) lines.push(`    now ${n.relation} ${n.text}  (${n.selector})`);
  return lines.join('\n');
}

export function describeComment(c: Comment): string {
  const kind = c.type === 'change-request' ? 'CHANGE REQUEST' : c.type === 'behavior' ? 'BEHAVIOR' : 'COMMENT';
  const lines = [`[${c.id}] ${kind} on ${c.element}  selector: ${c.selector}`, `    "${c.body}"`];
  for (const r of c.replies) lines.push(`    ${r.author}: "${r.body}"`);
  return lines.join('\n');
}

export function describeRound(s: Session, r: Round): string {
  const out = [`ROUND ${r.n}  status: ${r.status}  target: ${s.target} (${s.targetKind})`];
  if (s.root) out.push(`project folder: ${s.root}`);
  out.push('');
  const slides = new Set([...r.ops.map((o) => o.slide), ...r.comments.map((c) => c.slide)]);
  for (const id of s.slides.map((x) => x.id).filter((id) => slides.has(id))) {
    out.push(`SLIDE ${slideName(s, id)}`);
    const sl = s.slides.find((x) => x.id === id);
    if (sl?.path.length) out.push(`  reached by clicking: ${sl.path.map((p) => p.text).join(' > ')}`);
    if (sl?.frozen) {
      const from = s.slides.find((x) => x.id === sl.frozen!.from);
      out.push(`  FROZEN copy of ${from ? slideName(s, from.id) : sl.frozen.from}: the page exactly as it looked when the comment was made (live URL ${sl.frozen.url})`);
      out.push(`  saved page: frozen/${sl.id}.html in the session folder. The code to change is the live page's source.`);
      if (from?.path.length) out.push(`  the live page was reached by clicking: ${from.path.map((p) => p.text).join(' > ')}`);
    }
    for (const op of r.ops.filter((o) => o.slide === id)) out.push(indent(describeOp(op)));
    for (const c of r.comments.filter((c) => c.slide === id)) out.push(indent(describeComment(c)));
    out.push('');
  }
  for (const u of r.undo ?? []) {
    out.push(`UNDO [${u.id}] the change made for round ${u.round} item ${u.item}: "${u.label}"`);
    out.push(`    what you did then: "${u.note}"`);
    out.push(`    exact undo didn't work: ${u.reason}`);
    if (u.patch) out.push(`    recorded file changes: patches/${u.patch}.json in the session folder (before/after of each file)`);
    out.push('');
  }
  if (r.results.length) {
    out.push('RESULTS');
    for (const x of r.results) out.push(`  [${x.item}] ${x.state}: ${x.note}`);
  } else if (r.status === 'submitted') out.push(...howToApply(r));
  return out.join('\n').trimEnd();
}

/** The per-item order, spelled out with this round's numbers, so each change is recorded on its own. */
function howToApply(r: Round): string[] {
  const ids = [...r.ops.map((o) => o.id), ...r.comments.map((c) => c.id), ...(r.undo ?? []).map((u) => u.id)];
  return [
    'HOW TO APPLY (each item is recorded on its own so the user can undo it):',
    `  for each item: edit, then right away: result --round ${r.n} --item <id> --state applied|question --note "<what changed, for the user>"`,
    '  one item at a time; items built together share one result: --item <id1>,<id2>',
    '  a question note is the full question for the user, never one word',
    '  notes with quotes or apostrophes: --note-file <file> instead of --note',
    `  then: finish --round ${r.n}`,
    `  items: ${ids.join(', ')}`,
  ];
}

export function describeStatus(s: Session): string {
  const out: string[] = [`target: ${s.target}`];
  for (const sl of s.slides) {
    const open = s.comments.filter((c) => c.slide === sl.id && c.status === 'open').length;
    const ops = activeOps(s).filter((o) => o.slide === sl.id).length;
    out.push(`${sl.id} ${sl.label} (${sl.url}): ${open} open comment(s), ${ops} unsent edit(s)`);
  }
  for (const r of s.rounds) {
    const reviewed = Object.keys(r.review).length;
    const total = r.ops.length + r.comments.length;
    out.push(`round ${r.n}: ${r.status}, ${total} item(s), ${r.results.length} result(s), ${reviewed} reviewed`);
  }
  return out.join('\n');
}

const indent = (t: string) => t.split('\n').map((l) => '  ' + l).join('\n');
