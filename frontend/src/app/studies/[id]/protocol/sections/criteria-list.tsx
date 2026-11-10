"use client";

export function CriteriaList({
  label,
  items,
  onChange,
  readOnly,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-navy/85">{label}</span>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={item}
              disabled={readOnly}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none focus:border-navy/35 disabled:opacity-60"
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="rounded-lg border border-line px-2.5 text-navy/65 hover:bg-navy/5"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className="self-start text-sm font-medium text-navy/75 hover:text-navy"
          >
            + Add criterion
          </button>
        )}
      </div>
    </div>
  );
}
