'use client';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { kana } from '@/features/Kana/data/kana';
import useKanaStore from '@/features/Kana/store/useKanaStore';
import { CircleCheck, CircleX } from 'lucide-react';
import { Random } from 'random-js';
import { useCorrect, useError } from '@/shared/hooks/useAudio';
import GameIntel from '@/shared/components/Game/GameIntel';
import { getGlobalAdaptiveSelector } from '@/shared/lib/adaptiveSelection';
import Stars from '@/shared/components/Game/Stars';
import { useCrazyModeTrigger } from '@/features/CrazyMode/hooks/useCrazyModeTrigger';
import useStatsStore from '@/features/Progress/store/useStatsStore';
import { useShallow } from 'zustand/react/shallow';
import useStats from '@/shared/hooks/useStats';

const random = new Random();
const adaptiveSelector = getGlobalAdaptiveSelector();

// Duolingo-like spring animation config
const springConfig = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8
};

// Helper function to determine if a kana character is hiragana or katakana
const isHiragana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
};

const isKatakana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x30a0 && code <= 0x30ff;
};

interface TileProps {
  id: string;
  char: string;
  onClick: () => void;
  isDisabled?: boolean;
  isBlank?: boolean; // For blank placeholder tiles
}

// Memoized tile component for smooth animations
const Tile = memo(({ id, char, onClick, isDisabled, isBlank }: TileProps) => {
  // Blank placeholder tile (invisible but takes space)
  if (isBlank) {
    return (
      <div
        className={clsx(
          'relative flex items-center justify-center rounded-xl px-3 py-2 text-xl font-medium sm:px-4 sm:py-2.5 sm:text-2xl',
          'border-b-4 border-transparent bg-[var(--border-color)]/30',
          'select-none'
        )}
      >
        <span className='opacity-0'>{char}</span>
      </div>
    );
  }

  return (
    <motion.button
      layoutId={id}
      type='button'
      onClick={onClick}
      disabled={isDisabled}
      className={clsx(
        'relative flex cursor-pointer items-center justify-center rounded-xl px-3 py-2 text-xl font-medium transition-colors sm:px-4 sm:py-2.5 sm:text-2xl',
        'border-b-4 active:translate-y-[4px] active:border-b-0',
        'border-[var(--secondary-color-accent)] bg-[var(--secondary-color)] text-[var(--background-color)]',
        isDisabled && 'cursor-not-allowed opacity-50'
      )}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={springConfig}
    >
      {char}
    </motion.button>
  );
});

Tile.displayName = 'Tile';

interface WordBuildingGameProps {
  isHidden: boolean;
  isReverse: boolean; // true = romaji display, kana tiles; false = kana display, romaji tiles
  wordLength: number;
  onCorrect: (chars: string[]) => void;
  onWrong: () => void;
}

const WordBuildingGame = ({
  isHidden,
  isReverse,
  wordLength,
  onCorrect,
  onWrong
}: WordBuildingGameProps) => {
  const { playCorrect } = useCorrect();
  const { playErrorTwice } = useError();
  const { trigger: triggerCrazyMode } = useCrazyModeTrigger();

  const {
    score,
    setScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementWrongStreak,
    resetWrongStreak
  } = useStatsStore(
    useShallow(state => ({
      score: state.score,
      setScore: state.setScore,
      incrementHiraganaCorrect: state.incrementHiraganaCorrect,
      incrementKatakanaCorrect: state.incrementKatakanaCorrect,
      incrementWrongStreak: state.incrementWrongStreak,
      resetWrongStreak: state.resetWrongStreak
    }))
  );

  const {
    incrementCorrectAnswers,
    incrementWrongAnswers,
    addCharacterToHistory,
    incrementCharacterScore
  } = useStats();

  const kanaGroupIndices = useKanaStore(state => state.kanaGroupIndices);

  // Get all available kana and romaji from selected groups
  const { selectedKana, selectedRomaji, kanaToRomaji, romajiToKana } =
    useMemo(() => {
      const kanaChars = kanaGroupIndices.map(i => kana[i].kana).flat();
      const romajiChars = kanaGroupIndices.map(i => kana[i].romanji).flat();

      const k2r: Record<string, string> = {};
      const r2k: Record<string, string> = {};

      kanaChars.forEach((k, i) => {
        k2r[k] = romajiChars[i];
        r2k[romajiChars[i]] = k;
      });

      return {
        selectedKana: kanaChars,
        selectedRomaji: romajiChars,
        kanaToRomaji: k2r,
        romajiToKana: r2k
      };
    }, [kanaGroupIndices]);

  const [feedback, setFeedback] = useState(<>{'Build the word!'}</>);

  // Generate a word (array of characters) and distractors
  const generateWord = useCallback(() => {
    const sourceChars = isReverse ? selectedRomaji : selectedKana;
    if (sourceChars.length < wordLength) {
      return { wordChars: [], answerChars: [], allTiles: [] };
    }

    // Select characters for the word using adaptive selection
    const wordChars: string[] = [];
    const usedChars = new Set<string>();

    for (let i = 0; i < wordLength; i++) {
      const available = sourceChars.filter(c => !usedChars.has(c));
      if (available.length === 0) break;

      const selected = adaptiveSelector.selectWeightedCharacter(available);
      wordChars.push(selected);
      usedChars.add(selected);
      adaptiveSelector.markCharacterSeen(selected);
    }

    // Get the answer characters (the tiles user needs to select)
    const answerChars = isReverse
      ? wordChars.map(r => romajiToKana[r])
      : wordChars.map(k => kanaToRomaji[k]);

    // Generate distractor tiles (extra incorrect options)
    const distractorCount = Math.min(3, sourceChars.length - wordLength);
    const distractorSource = isReverse ? selectedKana : selectedRomaji;
    const distractors: string[] = [];
    const usedAnswers = new Set(answerChars);

    for (let i = 0; i < distractorCount; i++) {
      const available = distractorSource.filter(
        c => !usedAnswers.has(c) && !distractors.includes(c)
      );
      if (available.length === 0) break;
      const selected = available[random.integer(0, available.length - 1)];
      distractors.push(selected);
    }

    // Combine and shuffle all tiles
    const allTiles = [...answerChars, ...distractors].sort(
      () => random.real(0, 1) - 0.5
    );

    return { wordChars, answerChars, allTiles };
  }, [
    isReverse,
    selectedKana,
    selectedRomaji,
    wordLength,
    kanaToRomaji,
    romajiToKana
  ]);

  // Current word state
  const [wordData, setWordData] = useState(() => generateWord());
  const [placedTiles, setPlacedTiles] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Reset the game with a new word
  const resetGame = useCallback(() => {
    const newWord = generateWord();
    setWordData(newWord);
    setPlacedTiles([]);
    setIsChecking(false);
    setFeedback(<>{'Build the word!'}</>);
  }, [generateWord]);

  // Regenerate word when direction or length changes
  useEffect(() => {
    resetGame();
  }, [isReverse, wordLength, resetGame]);

  // Check if answer is correct when all slots are filled
  useEffect(() => {
    if (
      placedTiles.length === wordData.wordChars.length &&
      wordData.wordChars.length > 0 &&
      !isChecking
    ) {
      setIsChecking(true);

      // Check if placed tiles match the answer in order
      const isCorrect = placedTiles.every(
        (tile, i) => tile === wordData.answerChars[i]
      );

      if (isCorrect) {
        playCorrect();
        triggerCrazyMode();
        resetWrongStreak();

        // Track stats for each character
        wordData.wordChars.forEach(char => {
          addCharacterToHistory(char);
          incrementCharacterScore(char, 'correct');
          adaptiveSelector.updateCharacterWeight(char, true);

          // Track content-specific stats
          if (isHiragana(char)) {
            incrementHiraganaCorrect();
          } else if (isKatakana(char)) {
            incrementKatakanaCorrect();
          }
        });

        incrementCorrectAnswers();
        setScore(score + wordData.wordChars.length);

        setFeedback(
          <>
            <span>
              {wordData.wordChars.join('')} = {wordData.answerChars.join('')}
            </span>
            <CircleCheck className='ml-2 inline text-[var(--main-color)]' />
          </>
        );

        // Notify parent and generate new word after delay
        setTimeout(() => {
          onCorrect(wordData.wordChars);
          resetGame();
        }, 800);
      } else {
        playErrorTwice();
        triggerCrazyMode();
        incrementWrongStreak();
        incrementWrongAnswers();

        // Track wrong for each character
        wordData.wordChars.forEach(char => {
          incrementCharacterScore(char, 'wrong');
          adaptiveSelector.updateCharacterWeight(char, false);
        });

        if (score - 1 >= 0) {
          setScore(score - 1);
        }

        setFeedback(
          <>
            <span>Wrong order! Try again</span>
            <CircleX className='ml-2 inline text-[var(--main-color)]' />
          </>
        );

        onWrong();

        // Clear placed tiles after shake animation
        setTimeout(() => {
          setPlacedTiles([]);
          setIsChecking(false);
        }, 600);
      }
    }
  }, [
    placedTiles,
    wordData,
    isChecking,
    playCorrect,
    playErrorTwice,
    triggerCrazyMode,
    resetWrongStreak,
    incrementWrongStreak,
    addCharacterToHistory,
    incrementCharacterScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementCorrectAnswers,
    incrementWrongAnswers,
    score,
    setScore,
    onCorrect,
    onWrong,
    resetGame
  ]);

  // Handle tile click - either place or remove
  const handleTileClick = useCallback(
    (char: string) => {
      if (isChecking) return;

      if (placedTiles.includes(char)) {
        // Remove from placed tiles (clicks on placed tile)
        setPlacedTiles(prev => prev.filter(c => c !== char));
      } else if (placedTiles.length < wordData.wordChars.length) {
        // Add to placed tiles
        setPlacedTiles(prev => [...prev, char]);
      }
    },
    [isChecking, placedTiles, wordData.wordChars.length]
  );

  // Not enough characters for word building
  if (selectedKana.length < wordLength || wordData.wordChars.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        'flex w-full flex-col items-center gap-6 sm:w-4/5 sm:gap-10',
        isHidden && 'hidden'
      )}
    >
      <GameIntel gameMode='word-building' feedback={feedback} />

      {/* Word Display - matches normal Pick game styling */}
      <div className='flex flex-row items-center gap-1'>
        <motion.p
          className='text-8xl font-medium sm:text-9xl'
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          key={wordData.wordChars.join('')}
        >
          {wordData.wordChars.join('')}
        </motion.p>
      </div>

      {/* Answer Row Area - bordered section like Duolingo */}
      <div className='flex w-full flex-col items-center'>
        <div className='flex h-24 w-full items-center border-t-2 border-b-2 border-[var(--border-color)] px-4 sm:w-1/2'>
          <div className='flex flex-row flex-wrap justify-start gap-3'>
            <AnimatePresence mode='popLayout'>
              {placedTiles.map((char, index) => (
                <Tile
                  key={`placed-${index}-${char}`}
                  id={`tile-${char}`}
                  char={char}
                  onClick={() => handleTileClick(char)}
                  isDisabled={isChecking}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Available Tiles - blank placeholders stay in place */}
      <div className='flex flex-row flex-wrap justify-center gap-3 sm:gap-4'>
        {wordData.allTiles.map((char, index) => {
          const isPlaced = placedTiles.includes(char);
          return (
            <Tile
              key={`option-${char}-${index}`}
              id={`tile-${char}`}
              char={char}
              onClick={() => handleTileClick(char)}
              isDisabled={isChecking}
              isBlank={isPlaced}
            />
          );
        })}
      </div>

      <Stars />
    </div>
  );
};

export default WordBuildingGame;
