'use client';
import { useEffect, useState, useRef } from 'react';
import themeSets from '@/features/Preferences/data/themes';
import { useClick } from '@/shared/hooks/useAudio';
import clsx from 'clsx';

// Explosion animation styles
const explosionKeyframes = `
@keyframes explode {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.5);
    opacity: 0.5;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

@keyframes fadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
`;

type RawKanjiEntry = {
  kanjiChar: string;
};

type DecorationFont = {
  name: string;
  font: {
    className: string;
  };
};

const kanjiSources = ['N5', 'N4', 'N3'] as const;

const shuffle = <T,>(arr: T[]) => arr.slice().sort(() => Math.random() - 0.5);

// Tailwind animations
const animations = [
  'motion-safe:animate-pulse'
  // 'animate-bounce',
  //   'animate-ping',
  //   'animate-spin',
];

// Get all available main colors from themes
const getAllMainColors = () => {
  const colors = new Set<string>();
  /* themeSets.forEach(themeGroup => {
    themeGroup.themes.forEach(theme => {
      colors.add(theme.mainColor);
      if (theme.secondaryColor) colors.add(theme.secondaryColor);
    });
  }); */
  themeSets[2].themes.forEach(theme => {
    colors.add(theme.mainColor);
    if (theme.secondaryColor) colors.add(theme.secondaryColor);
  });
  return Array.from(colors);
};

const allMainColors = getAllMainColors();

// Lazy-load fonts cache
let fontsCache: DecorationFont[] | null = null;
let fontsLoadingPromise: Promise<DecorationFont[]> | null = null;

const loadDecorationFonts = async (
  forceLoad = false
): Promise<DecorationFont[]> => {
  // Only load decoration fonts in production (unless forced)
  if (process.env.NODE_ENV !== 'production' && !forceLoad) {
    return [];
  }

  if (fontsCache) return fontsCache;
  if (fontsLoadingPromise) return fontsLoadingPromise;

  fontsLoadingPromise = import('./decorationFonts').then(module => {
    fontsCache = module.decorationFonts;
    fontsLoadingPromise = null;
    return module.decorationFonts;
  });

  return fontsLoadingPromise;
};

type AnimState = 'idle' | 'exploding' | 'hidden' | 'fading-in';

// Get neighbors for a given index in a grid
const getNeighbors = (
  index: number,
  columns: number,
  total: number
): number[] => {
  const row = Math.floor(index / columns);
  const col = index % columns;
  const neighbors: number[] = [];

  // Left
  if (col > 0) neighbors.push(index - 1);
  // Right
  if (col < columns - 1) neighbors.push(index + 1);
  // Top
  if (row > 0) neighbors.push(index - columns);
  // Bottom
  if (index + columns < total) neighbors.push(index + columns);

  return neighbors;
};

// Component to render a single kanji character with random styles
const KanjiCharacter = ({
  char,
  forceShow = false,
  interactive = false,
  animState = 'idle',
  onExplode
}: {
  char: string;
  forceShow?: boolean;
  interactive?: boolean;
  animState?: AnimState;
  onExplode?: () => void;
}) => {
  const [mounted, setMounted] = useState(false);
  const [styles, setStyles] = useState({
    color: '',
    fontClass: '',
    animation: ''
  });
  // Store a stable animation delay
  const [animationDelay] = useState(() => `${Math.random() * 1000}ms`);

  useEffect(() => {
    let isMounted = true;

    const initializeStyles = async () => {
      // Lazy load fonts
      const fonts = await loadDecorationFonts(forceShow);

      if (!isMounted) return;

      // Generate random styles on mount
      const randomColor =
        allMainColors[Math.floor(Math.random() * allMainColors.length)];
      const randomFont =
        fonts.length > 0
          ? fonts[Math.floor(Math.random() * fonts.length)]
          : null;
      const randomAnimation =
        animations[Math.floor(Math.random() * animations.length)];

      setStyles({
        color: randomColor,
        fontClass: randomFont?.font.className ?? '',
        animation: randomAnimation
      });
      setMounted(true);
    };

    void initializeStyles();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleClick = () => {
    if (!interactive || animState !== 'idle' || !onExplode) return;
    onExplode();
  };

  if (!mounted) return null;

  const getAnimationStyle = () => {
    if (!interactive) {
      return { animationDelay };
    }
    switch (animState) {
      case 'exploding':
        return { animation: 'explode 300ms ease-out forwards' };
      case 'hidden':
        return { opacity: 0 };
      case 'fading-in':
        return { animation: 'fadeIn 500ms ease-in forwards' };
      default:
        return {};
    }
  };

  return (
    <span
      className={clsx(
        'text-4xl inline-flex items-center justify-center',
        styles.fontClass,
        !interactive && styles.animation,
        interactive && 'cursor-pointer'
      )}
      aria-hidden='true'
      style={{
        color: styles.color,
        transformOrigin: 'center center',
        ...getAnimationStyle()
      }}
      onClick={interactive ? handleClick : undefined}
    >
      {char}
    </span>
  );
};

// Custom hook to get current column count based on screen size
const useColumns = (interactive: boolean) => {
  const [columns, setColumns] = useState(28);

  useEffect(() => {
    if (!interactive) {
      setColumns(28);
      return;
    }

    const updateColumns = () => {
      // md breakpoint is 768px
      setColumns(window.innerWidth >= 768 ? 28 : 10);
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, [interactive]);

  return columns;
};

const Decorations = ({
  expandDecorations,
  forceShow = false,
  interactive = false
}: {
  expandDecorations: boolean;
  forceShow?: boolean;
  interactive?: boolean;
}) => {
  const [kanjiList, setKanjiList] = useState<string[]>([]);
  const [animStates, setAnimStates] = useState<Map<number, AnimState>>(
    new Map()
  );
  // Use ref for synchronous chain tracking (state updates are async and cause infinite loops)
  const explodedInChainRef = useRef<Set<number>>(new Set());
  // Track if user has already triggered an explosion (single-click only)
  const hasTriggeredRef = useRef(false);
  const columns = useColumns(interactive);
  const { playClick } = useClick();

  useEffect(() => {
    let isMounted = true;

    const loadKanji = async () => {
      const results = await Promise.all(
        kanjiSources.map(async level => {
          const response = await fetch(`/kanji/${level}.json`);
          const data = (await response.json()) as RawKanjiEntry[];
          return data.map(entry => entry.kanjiChar);
        })
      );

      if (!isMounted) return;
      setKanjiList(shuffle(results.flat()));
    };

    void loadKanji();

    return () => {
      isMounted = false;
    };
  }, []);

  const triggerExplosion = (index: number, isChainReaction = false) => {
    // Check if already in current chain (synchronous check via ref)
    if (explodedInChainRef.current.has(index)) return;

    // Only allow one initial click per page load
    if (!isChainReaction) {
      if (hasTriggeredRef.current) return;
      hasTriggeredRef.current = true;
      playClick();
      // Reset chain tracking for new explosion
      explodedInChainRef.current = new Set([index]);
    } else {
      explodedInChainRef.current.add(index);
    }

    // Set to exploding
    setAnimStates(prev => new Map(prev).set(index, 'exploding'));

    // Trigger neighbors after delay
    setTimeout(() => {
      const neighbors = getNeighbors(index, columns, kanjiList.length);
      neighbors.forEach((neighborIndex, i) => {
        setTimeout(() => {
          triggerExplosion(neighborIndex, true);
        }, i * 30); // Stagger neighbor explosions
      });
    }, 50);

    // Animation state transitions
    setTimeout(() => {
      setAnimStates(prev => new Map(prev).set(index, 'hidden'));
      setTimeout(() => {
        setAnimStates(prev => new Map(prev).set(index, 'fading-in'));
        setTimeout(() => {
          setAnimStates(prev => {
            const next = new Map(prev);
            next.delete(index);
            return next;
          });
        }, 500);
      }, 1500);
    }, 300);
  };

  return (
    <>
      {interactive && <style>{explosionKeyframes}</style>}
      <div
        className={clsx(
          'fixed inset-0 overflow-hidden',
          expandDecorations ? 'opacity-100' : 'opacity-30',
          interactive ? 'pointer-events-auto' : 'pointer-events-none'
        )}
      >
        <div
          className={clsx(
            'grid gap-0.5 p-2 h-full w-full',
            interactive ? 'grid-cols-10 md:grid-cols-28' : 'grid-cols-28'
          )}
        >
          {kanjiList.map((char, index) => (
            <KanjiCharacter
              char={char}
              key={index}
              forceShow={forceShow}
              interactive={interactive}
              animState={animStates.get(index) ?? 'idle'}
              onExplode={() => triggerExplosion(index)}
            />
          ))}
        </div>
      </div>
    </>
  );
};

export default Decorations;
