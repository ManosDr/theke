"use client";

import { useEffect } from "react";

import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { LanguageToggle } from "./LanguageToggle";
import { LegalFooter } from "./LegalFooter";
import { Logo, LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./LandingPage.module.css";

// Ports the design handoff's own IntersectionObserver reveal logic
// (see Theke Landing Page.dc.html's _setupReveal()) as a plain effect
// instead of a reusable hook - this page is the only place it's used.
// Hidden styles are applied here, in JS, after mount - never in the
// server-rendered HTML/CSS - so a script failure leaves every section
// visible by default (the design's own documented no-JS fail-safe).
function useScrollReveal() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const revealEls = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    revealEls.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(26px)";
      el.style.transition = "opacity .7s cubic-bezier(.22,.61,.36,1), transform .7s cubic-bezier(.22,.61,.36,1)";
      el.style.transitionDelay = `${el.dataset.revealDelay || "0"}ms`;
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.opacity = "1";
            el.style.transform = "none";
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));

    // The trust card's source block - the "signature moment" per the design
    // handoff: sources fade in 480ms after the card enters view, so they
    // appear to "resolve" after the answer (reinforcing "not a black box").
    const sourceEls = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal-source]"));
    sourceEls.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(12px)";
      el.style.transition = "opacity .6s ease, transform .6s ease";
    });
    const sio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            setTimeout(() => {
              el.style.opacity = "1";
              el.style.transform = "none";
            }, 480);
            sio.unobserve(el);
          }
        });
      },
      { threshold: 0.4 }
    );
    sourceEls.forEach((el) => sio.observe(el));

    return () => {
      io.disconnect();
      sio.disconnect();
    };
  }, []);
}

// Public marketing page shown at "/" for logged-out visitors (see
// app/page.tsx) - recreates the hifi design handoff ("Theke Landing Page"
// bundle) using the app's own components/tokens/i18n instead of the
// prototype's standalone markup. The Q&A example content below (hero card,
// two-path question chips, trust card) is real output captured live from
// /chat/message, not invented copy - see the "landing.*" keys' own comment
// in translations.ts and KNOWN_DECISIONS.md's Phase 4 entry for exactly
// which real questions/answers/citations were used and why.
export function LandingPage() {
  const { t } = useLocale();
  useScrollReveal();

  return (
    <div className={styles.root} id="top">
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="#top" className={styles.wordmark}>
            <LogoMark size={28} />
            <span className={styles.wordmarkText}>theke</span>
          </a>
          <div className={styles.headerControls}>
            <LanguageToggle />
            <ThemeToggle />
            <a href="/login" className={styles.navLink}>
              {t("landing.navLogin")}
            </a>
            <a href="/register" className="btn btn-primary">
              {t("landing.navCta")}
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.heroRow}`}>
          <div className={styles.heroLeft} data-reveal>
            <p className={styles.eyebrow}>{t("landing.heroEyebrow")}</p>
            <h1 className={styles.h1}>{t("landing.heroH1")}</h1>
            <p className={styles.heroSub}>{t("landing.heroSub")}</p>
            <div className={styles.ctaRow}>
              <a href="/register" className={`btn btn-primary ${styles.ctaPrimary}`}>
                {t("landing.navCta")}
              </a>
              <a href="/login" className={`btn btn-secondary ${styles.ctaSecondary}`}>
                {t("landing.navLogin")}
              </a>
            </div>
            <p className={styles.trialLine}>
              <span className={styles.checkMark}>✓</span> {t("landing.trialLine")}
            </p>
          </div>

          <div className={styles.heroRight} data-reveal data-reveal-delay="140">
            <div className={styles.mockCard}>
              <div className={styles.mockCardHeader}>
                <LogoMark size={9} />
                <span className={styles.mockCardLabel}>{t("landing.heroCardLabel")}</span>
              </div>
              <div className={styles.userBubble}>{t("landing.qConstruction")}</div>
              <div className={styles.assistantRow}>
                <LogoMark size={8} />
                <span className={styles.assistantName}>theke</span>
              </div>
              <p className={styles.assistantAnswer}>{t("landing.heroAnswer")}</p>
              <p className={styles.sourcesLabel}>{t("landing.sources")}</p>
              <div className={styles.chipRow}>
                <span className={styles.citationChip}>
                  <span className={styles.citationDot} />
                  {t("landing.heroSrc1")}
                </span>
                <span className={styles.citationChip}>
                  <span className={styles.citationDot} />
                  {t("landing.heroSrc2")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={`${styles.section} ${styles.sectionSurface}`}>
        <div className={styles.container}>
          <div className={styles.sectionIntro} data-reveal>
            <p className={styles.eyebrow}>{t("landing.howEyebrow")}</p>
            <h2 className={styles.h2}>{t("landing.howH2")}</h2>
          </div>
          <div className={styles.stepGrid}>
            {(["step1", "step2", "step3", "step4"] as const).map((step, i) => (
              <div key={step} className={styles.stepCard} data-reveal data-reveal-delay={i * 90}>
                <div className={i === 3 ? styles.stepTileFinal : styles.stepTile}>{`0${i + 1}`}</div>
                <h3 className={styles.stepTitle}>{t(`landing.${step}Title` as TranslationKey)}</h3>
                <p className={styles.stepBody}>{t(`landing.${step}Body` as TranslationKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TWO-PATH VERTICAL SELECTOR */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionIntroCentered} data-reveal>
            <p className={styles.eyebrow}>{t("landing.pathEyebrow")}</p>
            <h2 className={styles.h2}>{t("landing.pathH2")}</h2>
            <p className={styles.sectionSub}>{t("landing.pathSub")}</p>
          </div>
          <div className={styles.pathGrid}>
            <div className={`${styles.pathCard} ${styles.pathCardCon}`} data-reveal>
              <span className={`${styles.badge} ${styles.badgeCon}`}>{t("landing.conBadge")}</span>
              <h3 className={styles.pathTitle}>{t("landing.conTitle")}</h3>
              <p className={styles.pathDesc}>{t("landing.conDesc")}</p>
              <p className={styles.exampleLabel}>{t("landing.exampleLabel")}</p>
              <div className={styles.questionChip}>
                <span className={`${styles.questionMark} ${styles.questionMarkCon}`}>;</span>
                <span>{t("landing.qConstruction")}</span>
              </div>
              <a href="/register" className={`${styles.pathCta} ${styles.pathCtaCon}`}>
                {t("landing.conCta")} <span aria-hidden="true">→</span>
              </a>
            </div>

            <div className={`${styles.pathCard} ${styles.pathCardTax}`} data-reveal data-reveal-delay="120">
              <span className={`${styles.badge} ${styles.badgeTax}`}>{t("landing.taxBadge")}</span>
              <h3 className={styles.pathTitle}>{t("landing.taxTitle")}</h3>
              <p className={styles.pathDesc}>{t("landing.taxDesc")}</p>
              <p className={styles.exampleLabel}>{t("landing.exampleLabel")}</p>
              <div className={styles.questionChip}>
                <span className={`${styles.questionMark} ${styles.questionMarkTax}`}>;</span>
                <span>{t("landing.qTax")}</span>
              </div>
              <a href="/register" className={`${styles.pathCta} ${styles.pathCtaTax}`}>
                {t("landing.taxCta")} <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST / CREDIBILITY */}
      <section className={`${styles.section} ${styles.sectionSurface}`}>
        <div className={`${styles.container} ${styles.trustRow}`}>
          <div className={styles.trustLeft} data-reveal>
            <p className={styles.eyebrow}>{t("landing.trustEyebrow")}</p>
            <h2 className={styles.h2}>{t("landing.trustH2")}</h2>
            <p className={styles.trustIntro}>{t("landing.trustIntro")}</p>
            <div className={styles.honestyBox}>
              <p className={styles.honestyTitle}>{t("landing.honestyTitle")}</p>
              <p className={styles.honestyBody}>{t("landing.honestyBody")}</p>
            </div>
          </div>

          <div className={styles.trustRight} data-reveal data-reveal-delay="140">
            <div className={styles.mockCard}>
              <div className={styles.mockCardHeader}>
                <LogoMark size={9} />
                <span className={styles.mockCardLabel}>{t("landing.trustCardLabel")}</span>
              </div>
              <div className={styles.userBubble}>{t("landing.qTax")}</div>
              <div className={styles.assistantRow}>
                <LogoMark size={8} />
                <span className={styles.assistantName}>theke</span>
              </div>
              <p className={styles.assistantAnswer}>{t("landing.trustAnswer")}</p>
              <p className={styles.trustAnswerNote}>{t("landing.trustAnswerNote")}</p>

              <div data-reveal-source>
                <p className={styles.sourcesLabel}>
                  <span className={styles.checkMark}>✓</span> {t("landing.verifiedSources")}
                </p>
                <div className={styles.sourceList}>
                  <div className={styles.sourceRow}>
                    <span className={styles.sourceTile}>§</span>
                    <div>
                      <p className={styles.sourceRef}>{t("landing.src1Ref")}</p>
                      <p className={styles.sourceDesc}>{t("landing.src1Desc")}</p>
                    </div>
                  </div>
                  <div className={styles.sourceRow}>
                    <span className={styles.sourceTile}>§</span>
                    <div>
                      <p className={styles.sourceRef}>{t("landing.src2Ref")}</p>
                      <p className={styles.sourceDesc}>{t("landing.src2Desc")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={styles.ctaBand}>
        <div className={`${styles.container} ${styles.ctaBandInner}`} data-reveal>
          <h2 className={styles.ctaH2}>{t("landing.finalH2")}</h2>
          <p className={styles.ctaSub}>{t("landing.finalSub")}</p>
          <div className={styles.ctaRow} style={{ justifyContent: "center" }}>
            <a href="/register" className={styles.ctaBandPrimary}>
              {t("landing.navCta")}
            </a>
            <a href="/login" className={styles.ctaBandSecondary}>
              {t("landing.navLogin")}
            </a>
          </div>
          <p className={styles.ctaReassure}>{t("landing.finalReassure")}</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <Logo size={30} />
        <LegalFooter />
      </footer>
    </div>
  );
}
