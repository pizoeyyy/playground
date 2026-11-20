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
  if (op.insert) {
    lines.push(`    new ${op.insert.kind ?? 'element'} ${op.insert.position === 'append' ? 'inside' : 'after'} ${op.insert.ref}:`);
    lines.push(`    ${op.insert.html}`);
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
  const out = [`ROUND ${r.n}  status: ${r.status}  target: ${s.target} (${s.targetKind})`, ''];
  const slides = new Set([...r.ops.map((o) => o.slide), ...r.comments.map((c) => c.slide)]);
  for (const id of s.slides.map((x) => x.id).filter((id) => slides.has(id))) {
    out.push(`SLIDE ${slideName(s, id)}`);
    const sl = s.slides.find((x) => x.id === id);
    if (sl?.path.length) out.push(`  reached by clicking: ${sl.path.map((p) => p.text).join(' > ')}`);
    for (const op of r.ops.filter((o) => o.slide === id)) out.push(indent(describeOp(op)));
    for (const c of r.comments.filter((c) => c.slide === id)) out.push(indent(describeComment(c)));
    out.push('');
  }
  if (r.results.length) {
    out.push('RESULTS');
    for (const x of r.results) out.push(`  [${x.item}] ${x.state}: ${x.note}`);
  }
  return out.join('\n').trimEnd();
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
