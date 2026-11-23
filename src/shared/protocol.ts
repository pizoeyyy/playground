// postMessage protocol between the editor (parent) and the agent (inside the page iframe).
import type { ComponentKind } from './components.ts';
import type { CommentType, Op, Step } from './types.ts';

export type Mode = 'select' | 'interact' | 'add' | 'comment';

export type Rect = { x: number; y: number; w: number; h: number };

export type ElementInfo = {
  selector: string;
  element: string; // 'button "Buy now"'
  tag: string;
  text: string | null; // editable text, null when the element has no simple text
  rect: Rect;
  styles: { color: string; background: string; border: string; fontSize: string; radius: string };
  translate: { x: number; y: number };
};

/** An op as created by the agent; the editor adds `slide` and `at`. */
export type AgentOp = Omit<Op, 'slide' | 'at'>;

export type FromAgent =
  | { type: 'ready'; url: string; title: string }
  | { type: 'nav'; url: string; kind: 'push' | 'replace' | 'pop' | 'hash' }
  | { type: 'clicked'; step: Step }
  | { type: 'selected'; info: ElementInfo | null }
  | { type: 'op'; op: AgentOp }
  | { type: 'compose'; kind: CommentType; selector: string; element: string; rect: Rect }
  | { type: 'rects'; rects: Record<string, Rect | null> }
  | { type: 'key'; key: string; ctrl: boolean; shift: boolean; alt: boolean }
  | { type: 'thumb'; dataUrl: string; slide?: string }
  | { type: 'frozen'; req: number; html: string; version: number; loadId: string; url: string; title: string; frozen: boolean }
  | { type: 'notice'; text: string }
  | { type: 'aligned'; count: number }
  | { type: 'mode'; mode: Mode }
  | { type: 'menu'; x: number; y: number; selector: string; element: string; rect: Rect; clickable: boolean; hasText: boolean; hasParent: boolean }
  | { type: 'dismiss' }
  | { type: 'added'; kind: string };

export type ToAgent =
  | { type: 'init'; ops: Op[]; mode: Mode; grid: boolean; gridSize: number; pins: string[]; addKind: ComponentKind; thumbs: boolean; zoom: number }
  | { type: 'thumbs'; on: boolean }
  | { type: 'zoom'; scale: number }
  | { type: 'resize'; selector: string; w: number | null; h: number | null }
  | { type: 'mode'; mode: Mode; addKind?: ComponentKind }
  | { type: 'grid'; show: boolean; size: number }
  | { type: 'apply'; op: Op }
  | { type: 'revert'; op: Op }
  | { type: 'style'; selector: string; prop: string; value: string; commit: boolean }
  | { type: 'text'; selector: string; value: string }
  | { type: 'nudge'; selector: string; x: number; y: number }
  | { type: 'duplicate' | 'delete' | 'selectParent' | 'editText' | 'click'; selector: string }
  | { type: 'select'; selector: string | null; scroll?: boolean }
  | { type: 'pins'; selectors: string[] }
  | { type: 'replay'; path: Step[] }
  | { type: 'capture'; slide?: string }
  | { type: 'freeze'; req: number }
  | { type: 'autoAlign' }
  | { type: 'menuClosed' }
  | { type: 'place'; x: number; y: number; what: 'add' | 'comment'; kind: ComponentKind }
  | { type: 'compose'; selector: string; kind: CommentType };

export const PG = '__pg';
