import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}

/** Bottom sheet on phones, centered panel on desktop. The native <dialog> gives Escape and focus trapping for free. */
export function Sheet({ open, onClose, labelledBy, className = '', children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()} // tap outside the panel to close
    >
      <div className="sheet-panel">{children}</div>
    </dialog>
  );
}

export function SheetHeader({ id, title, subtitle, onClose }: { id: string; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <header className="sheet-head">
      <div>
        <h3 id={id} className="sheet-title">{title}</h3>
        {subtitle && <p className="sheet-story">{subtitle}</p>}
      </div>
      <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
  );
}
