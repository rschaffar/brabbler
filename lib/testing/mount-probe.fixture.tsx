import * as React from 'react';

export function MountProbe({ label, onMount, onCleanup }: {
  label: string; onMount: () => void; onCleanup: () => void;
}) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => { onMount(); return onCleanup; }, [onMount, onCleanup]);
  return <button onClick={() => setCount(value => value + 1)}>{label}: {count}</button>;
}
