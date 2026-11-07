"use client";

import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  AUDIO_PLAYBACK_RATE_MIN as MIN,
  AUDIO_PLAYBACK_RATE_MAX as MAX,
  AUDIO_PLAYBACK_RATE_STEP as STEP,
  useAudioPlaybackRate,
  validAudioPlaybackRate,
} from "@/hooks/useAudioPlaybackRate";

export function AudioSpeedControl({ mediaRef, src }: {
  mediaRef: RefObject<HTMLMediaElement | null>;
  src: string;
}) {
  const { t } = useI18n();
  const { rate, setRate } = useAudioPlaybackRate();
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const apply = () => {
      media.preservesPitch = true;
      media.defaultPlaybackRate = rate;
      media.playbackRate = rate;
    };
    const changed = () => {
      // apply() also queues ratechange events. They are acknowledgements, not
      // new choices: never let them overwrite a newer, not-yet-observed peer write.
      if (media.playbackRate === rate) return;
      // Keep supported native speed-menu selections in sync with our controls.
      if (validAudioPlaybackRate(media.playbackRate)) setRate(media.playbackRate);
      else apply();
    };
    apply();
    media.addEventListener("loadedmetadata", apply);
    media.addEventListener("ratechange", changed);
    return () => {
      media.removeEventListener("loadedmetadata", apply);
      media.removeEventListener("ratechange", changed);
    };
  }, [mediaRef, src, rate, setRate]);
  const adjust = (delta: number) => {
    setDraft(null);
    setRate(Math.min(MAX, Math.max(MIN, rate + delta)));
  };
  return <span className="audio-speed-control" role="group" aria-label={t("audio.speedControls")}>
    <span className="audio-speed-heading">{t("audio.speed")}</span>
    <input className="audio-speed-slider" type="range" min={MIN} max={MAX} step={STEP} value={rate}
      aria-label={t("audio.speed")} aria-valuetext={t("audio.rate", { rate: rate.toFixed(2) })}
      onChange={event => { setDraft(null); setRate(event.currentTarget.valueAsNumber); }} />
    <span className="audio-speed-values">
      <button type="button" aria-label={t("audio.slower")} disabled={rate <= MIN} onClick={() => adjust(-STEP)}>−</button>
      <input className="audio-speed-exact" type="number" min={MIN} max={MAX} step="0.01" inputMode="decimal"
        aria-label={t("audio.exactSpeed")} title={t("audio.exactSpeedHelp")}
        value={draft ?? rate.toFixed(2)} onChange={event => setDraft(event.currentTarget.value)}
        onBlur={event => { setRate(event.currentTarget.valueAsNumber); setDraft(null); }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); }
        }} />
      <span aria-hidden="true">×</span>
      <button type="button" aria-label={t("audio.faster")} disabled={rate >= MAX} onClick={() => adjust(STEP)}>+</button>
      <button type="button" className="audio-speed-reset" disabled={rate === 1}
        onClick={() => { setDraft(null); setRate(1); }}>{t("audio.resetSpeed")}</button>
    </span>
  </span>;
}
