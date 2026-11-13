/** Text with code in backticks ("`Arc<Mutex>` is …") as React nodes, the code in `<code>` elements. */
export const ticks = (text: string): React.ReactNode => text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
