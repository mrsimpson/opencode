export const dict = {
  "app.loading": "Lädt...",
  "app.signedInAs": "Angemeldet als {{email}}",
  "app.yourSessions": "Deine Sitzungen",
  "app.newSession": "Neue Sitzung",
  "app.back": "← Zurück",
  "app.error.connect": "Verbindung fehlgeschlagen",
  "app.error.timeout": "Anfrage abgelaufen — der Router ist möglicherweise nicht erreichbar",

  "session.state.creating": "wird erstellt",
  "session.state.running": "läuft",
  "session.idle.stopsIn": "stoppt in ~{{minutes}}m",
  "session.idle.stoppedOn": "gestoppt am {{date}}",
  "session.idle.stoppingSoon": "stoppt gleich",

  "session.action.cancel": "Abbrechen",
  "session.action.resume": "Fortsetzen",
  "session.action.terminate": "Beenden",
  "session.action.terminating": "Wird beendet…",
  "session.terminate.title": "Sitzung beenden?",
  "session.terminate.description":
    '„{{repo}}" wird unwiderruflich gelöscht – alle nicht gespeicherten Änderungen gehen verloren.',

  "form.repoUrl.label": "Git-Repository-URL",
  "form.repoUrl.placeholder": "https://github.com/org/repo.git",
  "form.sourceBranch.label": "Quell-Branch (Startpunkt)",
  "form.sourceBranch.placeholder": "main",
  "form.sessionBranch.label": "Dein Sitzungs-Branch",
  "form.submit": "Sitzung starten",
  "form.submitting": "Wird gestartet...",
  "form.error.sessionBranch": "Sitzungs-Branch konnte nicht generiert werden – bitte erneut versuchen",
  "form.error.repoUrl.required": "Repository-URL ist erforderlich",
  "form.error.repoUrl.invalid": "Gib eine gültige HTTP(S)-Repository-URL ein",
  "form.error.sourceBranch.required": "Quell-Branch ist erforderlich",

  "loading.title": "Deine OpenCode-Sitzung wird gestartet...",
  "loading.subtitle": "Das dauert normalerweise nur wenige Sekunden.",

  "app.welcomeBack": "Willkommen zurück, {{email}}",
  "app.sessions": "Sitzungen",
  "app.recents": "Zuletzt verwendet",
  "app.newSession.repoUrl.placeholder": "https://github.com/org/repo.git",
  "app.newSession.sourceBranch.placeholder": "main",
  "app.newSession.prompt.placeholder": "Beschreibe eine Aufgabe oder stelle eine Frage",
  "app.newSession.sessionBranch.label": "Sitzungs-Branch",
  "sidebar.collapse": "Seitenleiste einklappen",
  "sidebar.expand": "Seitenleiste ausklappen",
  "session.state.ready": "Bereit",
  "session.state.inactive": "Inaktiv",
  "session.action.open": "Öffnen",
  "session.action.openInNewTab": "In neuem Tab öffnen",
} as const

export type DictKey = keyof typeof dict
