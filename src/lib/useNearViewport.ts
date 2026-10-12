import { useEffect, useRef, useState } from "react";

/**
 * Flips to true (once) when the element nears the viewport, so the ad-level
 * weekly query — the heaviest call — only runs if the user actually scrolls
 * (or jumps via the sidebar) to this section.
 */
export function useNearViewport<T extends Element>(rootMargin = "400px") {
    const ref = useRef<T>(null);
    const [near, setNear] = useState(
        () => typeof IntersectionObserver === "undefined"
    );

    useEffect(() => {
        const el = ref.current;
        if (near || !el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setNear(true);
                    observer.disconnect();
                }
            },
            { rootMargin }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [near, rootMargin]);

    return [ref, near] as const;
}
