import { createContext, useContext, useEffect } from 'react';

/** Lets a panel supply facts that belong in its enclosing section heading. */
export const SectionFrameSubtitleContext = createContext<
  ((subtitle: string | undefined) => void) | null
>(null);

/** Publish a subtitle while the panel that owns its data is mounted. */
export function useSectionFrameSubtitle(subtitle: string | undefined): void {
  const publish = useContext(SectionFrameSubtitleContext);
  useEffect(() => {
    if (publish === null) return;
    publish(subtitle);
    return () => publish(undefined);
  }, [publish, subtitle]);
}
