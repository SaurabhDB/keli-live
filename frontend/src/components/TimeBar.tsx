import { useI18n } from "../i18n/core";

interface Props {
  disabled: boolean; // no history available (database offline)
  steps: number; // slider max; the last step is "live"
  step: number;
  hours: number;
  timeOf: (step: number) => Date;
  playing: boolean;
  onStep: (step: number) => void;
  onPlay: () => void;
  onLive: () => void;
}

export function TimeBar({ disabled, steps, step, hours, timeOf, playing, onStep, onPlay, onLive }: Props) {
  const { t, dayClock } = useI18n();
  const live = step === steps;
  const pct = (step / steps) * 100;
  return (
    <div className={`timebar glass ${disabled ? "disabled" : ""}`} title={disabled ? t("time.disabled") : undefined}>
      <button className="play" onClick={onPlay} disabled={disabled} aria-label={playing ? t("time.pause") : t("time.play", { h: hours })}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
        )}
      </button>
      <div className="track">
        <input
          type="range"
          min={0}
          max={steps}
          value={step}
          onChange={(e) => onStep(Number(e.target.value))}
          disabled={disabled}
          aria-label={t("time.aria")}
          aria-valuetext={live ? t("time.live") : dayClock(timeOf(step))}
          style={{ ["--pct" as string]: `${pct}%` }}
        />
        <div className="ticks">
          {[hours, (hours * 3) / 4, hours / 2, hours / 4].map((h) => (
            <span key={h}>−{h} h</span>
          ))}
          <span>{t("time.tickNow")}</span>
        </div>
      </div>
      <div className="time">
        <b>{live ? t("time.now") : dayClock(timeOf(step))}</b>
        <button className={`live ${live ? "on" : ""}`} onClick={onLive} disabled={live}>
          {live ? t("time.liveButton") : t("time.back")}
        </button>
      </div>
    </div>
  );
}
