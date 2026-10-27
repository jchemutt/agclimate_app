"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, CloudRain, CloudSun, FileCode2, MapPinned, Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import type { CountrySummary } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { themeVars } from "@/lib/theme";
import Flag from "./Flag";

const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: () => <div className="globe" /> });

export default function CountryList() {
  const [list, setList] = useState<CountrySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.countries().then(setList).catch(() => setFailed(true));
  }, []);
  const lang = "en";
  const ready = list?.filter((c) => c.latest).length ?? 0;

  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden />
      <div className="landing-grid" aria-hidden />

      <div className="landing-inner">
        <header className="landing-top">
          <span className="brand-chip"><CloudSun size={16} aria-hidden /> AgClimate AF</span>
          <a className="top-link" href="/api/docs"><FileCode2 size={15} aria-hidden /> API for developers</a>
        </header>

        <div className="landing-body">
          <section className="landing-copy">
            <p className="kicker">Forecast. Localise. Advise.</p>
            <h1>Seasonal climate outlooks for farmers and pastoralists</h1>
            <p className="lede">
              Rainfall, drought, heat, crop water and livestock conditions for the coming months, turned into advisories for every
              administrative area, in the languages people use.
            </p>
            <div className="features">
              <Feature icon={<CloudRain size={18} />} title="Forecast"
                       text="Over 40 indicators: rainfall, season timing, crops, drought, heat and livestock" />
              <Feature icon={<MapPinned size={18} />} title="Localise"
                       text="From the whole country down to the ward" />
              <Feature icon={<Megaphone size={18} />} title="Advise"
                       text="What each outlook means for planting and grazing" />
            </div>
          </section>

          <section className="landing-pick">
            <div className="picker">
              <div className="picker-head">
                <h2>{t(lang, "chooseCountry")}</h2>
                <span className="count-badge">{list ? list.length : "…"}</span>
              </div>
              {failed ? <p className="picker-note">{t(lang, "loadFailed")}</p> : null}
              {!list && !failed ? <p className="picker-note">{t(lang, "loading")}</p> : null}
              <div className="picker-list">
                {list?.map((c) => <CountryCard key={c.id} c={c} />)}
              </div>
            </div>

            <div className="globe-wrap">
              <div className="globe-halo" aria-hidden />
              <Globe countries={(list ?? []).map((c) => ({ iso2: c.iso2, name: tx(c.name, "en"), ready: !!c.latest }))} />
              <p className="globe-caption">
                {list ? `${ready} of ${list.length} ${list.length === 1 ? "country" : "countries"} with a published outlook` : " "}
              </p>
            </div>
          </section>
        </div>

        <footer className="landing-foot">
          <span>Forecasts: ECMWF SEAS5 (Copernicus Climate Change Service), bias-corrected with AgERA5.</span>
          <span>Alliance of Bioversity International and CIAT</span>
        </footer>
      </div>
    </main>
  );
}

function CountryCard({ c }: { c: CountrySummary }) {
  const lang = c.default_language;
  return (
    <Link href={`/${c.id}`} className="country-card" style={themeVars(c.theme)}>
      <span className="country-flag"><Flag iso2={c.iso2} emoji={c.flag} /></span>
      <span className="country-text">
        <span className="country-name">
          {tx(c.name, lang)}
          {c.latest
            ? <span className="status ready">{tx(c.latest.season.label, lang)} {c.latest.init.slice(0, 4)}</span>
            : <span className="status soon">Coming soon</span>}
        </span>
        <span className="country-desc">
          {c.description ? tx(c.description, lang) : null}
          {c.latest ? ` Issued ${fmtDate(c.latest.init, "en")}.` : ""}
        </span>
      </span>
      <span className="open-pill">Open <ArrowRight size={15} aria-hidden /></span>
    </Link>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="feature">
      <span className="feature-icon" aria-hidden>{icon}</span>
      <p className="feature-title">{title}</p>
      <p className="feature-text">{text}</p>
    </div>
  );
}
