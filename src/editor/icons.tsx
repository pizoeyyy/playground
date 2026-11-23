const S = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconSelect = () => (
  <svg {...S}><path d="M3.5 2.5l9 4.2-3.9 1.2-1.4 3.8z" /></svg>
);
export const IconInteract = () => (
  <svg {...S}><path d="M6 8.5V3.2a1.2 1.2 0 012.4 0v4.3M8.4 7V6a1.2 1.2 0 012.4 0v1.6M10.8 7.4a1.2 1.2 0 012.2.7v2.4a4 4 0 01-4 4H8.3a3.6 3.6 0 01-2.8-1.4L3.2 10a1.1 1.1 0 011.7-1.4L6 9.7" /></svg>
);
export const IconAdd = () => (
  <svg {...S}><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M8 5.5v5M5.5 8h5" /></svg>
);
export const IconComment = () => (
  <svg {...S}><path d="M8 13.5a5.5 5.5 0 10-5.1-3.4L2.5 13.5l3.4-.4A5.5 5.5 0 008 13.5z" /></svg>
);
export const IconUndo = () => (
  <svg {...S}><path d="M5.5 4L3 6.5 5.5 9" /><path d="M3 6.5h6.5a3.5 3.5 0 010 7H7" /></svg>
);
export const IconRedo = () => (
  <svg {...S}><path d="M10.5 4L13 6.5 10.5 9" /><path d="M13 6.5H6.5a3.5 3.5 0 000 7H9" /></svg>
);
export const IconGrid = () => (
  <svg {...S}><path d="M2.5 6h11M2.5 10h11M6 2.5v11M10 2.5v11" /></svg>
);
export const IconAlign = () => (
  <svg {...S}><path d="M2.5 2.5v11" /><rect x="5" y="4" width="8" height="3" rx="1" /><rect x="5" y="9" width="5" height="3" rx="1" /></svg>
);
export const IconSend = () => (
  <svg {...S}><path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z" /></svg>
);
export const IconReplay = () => (
  <svg {...S} width={14} height={14}><path d="M3 8a5 5 0 109-3M12 2v3H9" /></svg>
);
export const IconClose = () => (
  <svg {...S} width={12} height={12}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const IconCheck = () => (
  <svg {...S} width={14} height={14}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
