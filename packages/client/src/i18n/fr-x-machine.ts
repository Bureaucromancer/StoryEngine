// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***The deliberately bad machine French*** —
 * [20 §12.4](../../../../docs/design/20-tech-stack.md),
 * [P11 §1.3](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***Not a translation, and the tag says so.*** `fr-x-machine` is BCP 47's
 * private-use subtag, which is the honest way to name a locale that is French
 * in shape and nobody's French in fact. A build that offered plain `fr` here
 * would promise French and deliver this, which is the failure
 * `UserSettings.tsx`'s `LOCALES` docstring already refuses for `de-DE`: *"an
 * untranslated `de-DE` would promise German and deliver English."* The same rule
 * applies one step along — a machine-filled `fr` would promise French and
 * deliver machine output.
 *
 * ***What it is for is the mechanism, not the words.*** §12.4 makes machine
 * translation *the primary mechanism rather than a fallback*, so the thing that
 * has to be right on day one is the machinery around it: per-key fallback,
 * layout under longer strings, and a locale a person can actually switch to
 * before any human translator exists. **Every failure this file is meant to
 * catch is a layout or a fallback failure**, and none of them depend on the
 * French being good — which is lucky, because it is not.
 *
 * ***It is deliberately partial, and that is the load-bearing part.*** §12.1:
 * *"partial translation is the steady state, not a transient condition to be
 * fixed… a 60%-translated UI should look like a bilingual UI, not a broken
 * one."* So whole namespaces are absent and, inside `play.input-kind`, the
 * hints are absent while the labels are present — which puts the **per key**
 * half of that rule on screen rather than only in a test: a button reads
 * *Parler* and its tooltip reads *Speak aloud*.
 *
 * ***And it is deliberately long.*** French runs roughly 15–20% longer than
 * English and machine French runs longer still, so several entries below are
 * padded past what a careful translator would write. A layout that only holds
 * English is a layout that will break on the first real locale, and the cheapest
 * moment to find that out is now, with a locale nobody is relying on.
 *
 * **Provenance**: §12.4 asks that *"every machine-filled entry carries a
 * provenance marker"*, so a translator can tell their own work from a script's.
 * Here the marker is the whole file — every entry in it is machine-made and
 * unreviewed, which one flag says better than four hundred. The per-entry marker
 * belongs with the **script** that fills gaps against a real locale, and that
 * script is §12.4's and not this stage's: there is nothing yet for a human to
 * have reviewed.
 */
export const MACHINE_FRENCH: Record<string, Record<string, string>> = {
  /**
   * *The labels without the hints*, which is the bilingual steady state made
   * visible. `do.label` is the deliberate howler: a machine reading **Do** as
   * an auxiliary rather than as an imperative produces something that is a word
   * in French and not the word — exactly §12.4's `actions.open` warning, where
   * *"a key alone is not enough to translate well"*.
   */
  'play.input-kind': {
    'do.label': 'Faites',
    'do.placeholder': 'Que faites-vous à cet instant précis ?',
    'say.label': 'Parler',
    'say.placeholder': 'Que dites-vous à voix haute ?',
    'think.label': 'Penser',
    'think.placeholder': 'À quoi pensez-vous, sans que personne ne l’entende ?',
    'story.label': 'Histoire',
    'story.placeholder': 'Que se passe-t-il ensuite dans l’histoire ?',
    'choice.label': 'Choisir',
    fallback: 'Que faites-vous à cet instant précis ?',
  },

  'reading.move': {
    do: 'fait',
    say: 'dit',
    think: 'pense',
    story: 'raconte',
    choice: 'choisit',
  },

  'reading.move-yours': {
    do: 'Vous faites',
    say: 'Vous dites',
    think: 'Vous pensez',
    story: 'Vous racontez',
    choice: 'Vous choisissez',
  },

  'settings.role': {
    prose: 'Rédaction de l’histoire',
    reasoning: 'Réflexion et raisonnement',
    fast: 'Petites tâches rapides en arrière-plan',
    vision: 'Lecture des images',
    embedding: 'Recherche dans votre bibliothèque',
    image: 'Création d’images',
    video: 'Création de vidéos',
    speech: 'Parole',
  },

  'lore.gate': {
    'entry-off': 'désactivée',
    'folder-off': 'désactivée : son dossier est désactivé',
    'book-off': 'désactivée : le livre entier est désactivé',
  },

  /**
   * *The layout stress test.* These three are already the longest strings on
   * the tag manager's one-control cycle, and machine French makes them longer
   * still. If anything on that dialog assumes a label fits on one line, this is
   * what finds it.
   */
  'tags.folder': {
    none: 'Ce n’est pas un dossier',
    open: 'Dossier ouvert — les membres restent également visibles dans la liste',
    closed: 'Dossier fermé — les membres restent masqués jusqu’à son ouverture',
  },

  'play.unmeasurable': {
    'role-unbound': 'aucun modèle n’est associé au rôle de rédaction',
    'role-dangling': 'le rôle de rédaction pointe vers une connexion qui n’existe plus',
    'no-prose-step': 'ce mode ne raconte rien du tout',
    'not-this-turn': 'ce tour ne racontera rien',
    'window-too-small': 'la fenêtre de contexte du modèle n’est pas plus grande que sa réponse',
  },

  'workbench.step.state': { ok: 'Exécuté', skipped: 'Ignoré', failed: 'Échoué' },
  'workbench.live.state': {
    running: 'En cours d’exécution',
    ok: 'Exécuté',
    skipped: 'Ignoré',
    failed: 'Échoué',
  },
  'workbench.ruling': { winner: 'Retenu', shadowed: 'Masqué', tombstoned: 'Supprimé' },
  'workbench.call-purpose': { prose: 'Prose', effects: 'Effets', verdict: 'Verdict' },
  'workbench.block-change': {
    same: 'Inchangé',
    ruling: 'Arbitrage déplacé',
    changed: 'Modifié',
    added: 'Uniquement après',
    removed: 'Uniquement avant',
  },
  'workbench.limit-source': {
    provider: 'la fenêtre déclarée par le point de terminaison',
    preset: 'le plafond défini par le préréglage',
    user: 'votre propre limite de contexte',
  },
  'workbench.rendition.state': { pending: 'En attente', ready: 'Prête', failed: 'Échouée' },
  'workbench.rendition.purpose': { illustration: 'Illustration', background: 'Arrière-plan' },

  /**
   * *Three of five*, so a panel that renders provenance shows two English words
   * beside three French ones — the bilingual row, in one place somebody will
   * actually look at.
   */
  'workbench.provenance': {
    manual: 'Écrit à la main',
    import: 'Importé',
    generated: 'Généré',
  },
};
