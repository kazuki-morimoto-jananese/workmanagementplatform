import { useId, useState } from "react";

export function AccountSearch({
  accounts,
  value,
  onChange,
  disabled = false,
  label = "対象の営業アカウント",
  clearLabel = "紐づけを解除",
}: {
  accounts: { id: string; name: string; ownerName?: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  clearLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = accounts.find((a) => a.id === value);
  const normalize = (s: string) =>
    s.normalize("NFKC").toLocaleLowerCase().replace(/\s/g, "");
  const matches = accounts
    .filter((a) =>
      normalize(a.name + a.id + (a.ownerName || "")).includes(normalize(query)),
    )
    .slice(0, 50);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  return (
    <div
      className="account-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={id + "-options"}
        aria-activedescendant={
          open && matches[active] ? id + "-option-" + active : undefined
        }
        disabled={disabled}
        placeholder="アカウント名・IDを入力して検索"
        value={
          open
            ? query
            : selected
              ? `${selected.name}（${selected.id}）${selected.ownerName ? ` · ${selected.ownerName}` : ""}`
              : ""
        }
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (matches[active]) choose(matches[active].id);
          }
        }}
      />
      {!disabled && value && (
        <button
          type="button"
          className="text-button"
          onClick={() => choose("")}
        >
          {clearLabel}
        </button>
      )}
      {open && (
        <div
          className="account-search-options"
          role="listbox"
          id={id + "-options"}
          aria-label="アカウント候補"
        >
          {matches.map((a, i) => (
            <div
              key={a.id}
              role="option"
              id={id + "-option-" + i}
              aria-selected={active === i}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a.id)}
            >
              {a.name}
              <small>
                {a.id}
                {a.ownerName ? ` · ${a.ownerName}` : ""}
              </small>
            </div>
          ))}
          {!matches.length && <p>一致するアカウントはありません</p>}
          {matches.length === 50 && (
            <p>先頭50件を表示中です。文字を追加して絞り込めます。</p>
          )}
        </div>
      )}
    </div>
  );
}
