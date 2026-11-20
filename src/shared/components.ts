// Things you can drop onto a page. The editor lists them; the agent builds them.
export type ComponentKind =
  | 'button' | 'card' | 'dropdown' | 'menu' | 'popup' | 'input' | 'toggle'
  | 'tabs' | 'alert' | 'badge' | 'heading' | 'text' | 'list' | 'image';

export const COMPONENTS: { kind: ComponentKind; label: string; hint: string; key?: string }[] = [
  { kind: 'button', label: 'Button', hint: 'Action or link', key: 'B' },
  { kind: 'card', label: 'Card', hint: 'Title and description' },
  { kind: 'dropdown', label: 'Dropdown', hint: 'Select from options' },
  { kind: 'menu', label: 'Menu', hint: 'Button that opens a list' },
  { kind: 'popup', label: 'Popup', hint: 'Dialog with actions' },
  { kind: 'input', label: 'Input', hint: 'Label and text field' },
  { kind: 'toggle', label: 'Toggle', hint: 'On / off switch' },
  { kind: 'tabs', label: 'Tabs', hint: 'Switch between views' },
  { kind: 'alert', label: 'Banner', hint: 'Notice or alert' },
  { kind: 'badge', label: 'Badge', hint: 'Small status label' },
  { kind: 'heading', label: 'Heading', hint: 'Section title' },
  { kind: 'text', label: 'Text', hint: 'Paragraph' },
  { kind: 'list', label: 'List', hint: 'Bulleted items' },
  { kind: 'image', label: 'Image', hint: 'Placeholder picture' },
];

export const componentLabel = (k: string) => COMPONENTS.find((c) => c.kind === k)?.label.toLowerCase() ?? k;
