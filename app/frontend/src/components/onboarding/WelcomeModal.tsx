'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'onboarding_done';

const steps = [
  {
    icon: '📊',
    title: '統合ダッシュボード',
    description: '金融流動性と米国景気リスクの2システムを統合した全体把握画面です。投資判断マトリクスで「今どうすべきか」が一目でわかります。',
  },
  {
    icon: '🔧',
    title: '米国金融流動性モニター',
    description: 'FRBの資金供給（L1）、銀行セクター（L2A）、市場レバレッジ（L2B）の3層で金融市場の健全性を監視します。',
  },
  {
    icon: '⚠️',
    title: '米国景気リスク評価モニター',
    description: '雇用（50点）、消費者（25点）、構造（25点）の3軸で100点満点の景気リスクスコアを算出します。',
  },
  {
    icon: '📈',
    title: '銘柄分析',
    description: 'テクニカル分析で個別銘柄のエントリータイミングを判定。BOS/CHoCH/FVGなどの構造分析を提供します。',
  },
  {
    icon: '💼',
    title: 'ポートフォリオ',
    description: 'ポートフォリオの保有状況、取引履歴、損益推移を管理。セクター別・口座別の分析も可能です。',
  },
];

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [skipNext, setSkipNext] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setOpen(true);
    }
  }, []);

  function handleComplete() {
    if (skipNext) {
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setOpen(false);
  }

  function handleSkip() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  }

  const current = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {isFirst ? 'Open Regime へようこそ' : `${current.icon} ${current.title}`}
          </DialogTitle>
          {isFirst && (
            <DialogDescription>
              金融市場の流動性と景気動向を監視し、投資判断をサポートするダッシュボードです。
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 py-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === step ? 'bg-primary w-5' : 'bg-muted-foreground/30 w-1.5'
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="plumb-glass rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{current.icon}</span>
            <div>
              <p className="text-sm font-bold">{current.title}</p>
              <p className="text-[11px] text-muted-foreground">ステップ {step + 1} / {steps.length}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {current.description}
          </p>
        </div>

        <DialogFooter className="flex items-center !justify-between">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={skipNext}
              onChange={(e) => setSkipNext(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-xs text-muted-foreground">次回から表示しない</span>
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              スキップ
            </Button>
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={() => setStep(s => s - 1)}>
                戻る
              </Button>
            )}
            <Button size="sm" onClick={isLast ? handleComplete : () => setStep(s => s + 1)}>
              {isLast ? '始める' : '次へ'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
