import { formatCurrency, formatNumber, formatRoas } from "@/lib/metrics";

type Row = {
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
};

type Props = {
    active?: boolean;
    payload?: Row[];
    label?: string | number;
    /** How to format each value: currency (₹), number, or roas. */
    format?: "currency" | "number" | "roas";
};

function longDate(label: string | number | undefined): string {
    if (label == null) return "";
    const d = new Date(String(label));
    if (Number.isNaN(d.getTime())) return String(label);
    return d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
}

/** Dark-themed, glass tooltip shared by every chart. */
export default function ChartTooltip({
    active,
    payload,
    label,
    format = "currency",
}: Props) {
    if (!active || !payload || payload.length === 0) return null;

    const fmt = (v: number) =>
        format === "currency"
            ? formatCurrency(v)
            : format === "roas"
              ? formatRoas(v)
              : formatNumber(v);

    return (
        <div className="glass min-w-40 rounded-[10px] px-3 py-2.5 shadow-xl">
            <p className="mb-1.5 text-xs font-medium text-ink-secondary">
                {longDate(label)}
            </p>
            <div className="flex flex-col gap-1">
                {payload.map((row, i) => (
                    <div
                        key={i}
                        className="flex items-center justify-between gap-4 text-sm"
                    >
                        <span className="flex items-center gap-2 text-ink-secondary">
                            <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: row.color }}
                            />
                            {row.name}
                        </span>
                        <span className="tnum font-semibold text-ink">
                            {fmt(Number(row.value ?? 0))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
