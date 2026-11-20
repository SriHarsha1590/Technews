export interface Tab {
  id: string;
  label: string;
}

interface Props {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
}

/** The row under the brand: "For you", the categories, then "Saved". */
export function ViewTabs({ tabs, value, onChange }: Props) {
  return (
    <nav className="tabs" aria-label="Views">
      {tabs.map((t) => (
        <button key={t.id} type="button" className="tab" aria-pressed={t.id === value} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
