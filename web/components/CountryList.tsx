"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CountrySummary } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";

export default function CountryList() {
  const [list, setList] = useState<CountrySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.countries().then(setList).catch(() => setFailed(true));
  }, []);
  const lang = "en";
  return (
    <main className="home">
      <header className="home-head">
        <p className="home-brand">AgClimate AF</p>
        <h1>Seasonal outlooks for farmers and pastoralists</h1>
        <p className="home-lede">
          Rainfall, drought and heat for the coming season, and what they mean for planting and grazing
          in each area.
        </p>
      </header>
      <h2 className="home-sub">{t(lang, "chooseCountry")}</h2>
      {failed ? <p className="muted">{t(lang, "loadFailed")}</p> : null}
      {!list && !failed ? <p className="muted">{t(lang, "loading")}</p> : null}
      <ul className="countries">
        {list?.map((c) => (
          <li key={c.id}>
            <Link href={`/${c.id}`} className="country-row">
              <span className="country-flag" aria-hidden>{c.flag}</span>
              <span className="country-name">{tx(c.name, c.default_language)}</span>
              <span className="country-status">
                {c.latest
                  ? `${tx(c.latest.season.label, c.default_language)} ${c.latest.init.slice(0, 4)}, issued ${fmtDate(c.latest.init, lang)}`
                  : t(lang, "noForecast")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
