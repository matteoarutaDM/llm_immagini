import { useSyncExternalStore } from "react";

import { DEFAULT_ANSWER_LANGUAGE, getAnswerLanguage, setAnswerLanguage, type AnswerLanguage } from "./answerLanguage";

/**
 * Interface translations for the login page and the main page. The Italian text
 * is the key, so components stay readable and Italian needs no entry; a missing
 * translation falls back to Italian. Placeholders like {title} are filled by t().
 * Texts coming from the server (errors, recognition notes) stay as they arrive.
 *
 * Order of each tuple: English, Spanish, German, French.
 */
const TRANSLATIONS: Record<string, [en: string, es: string, de: string, fr: string]> = {
  // Login, first access, password recovery, 2FA
  "Lingua": ["Language", "Idioma", "Sprache", "Langue"],
  "Supporto tecnico aumentato": ["Augmented technical support", "Soporte técnico aumentado", "Erweiterter technischer Support", "Support technique augmenté"],
  "Dalla fotografia alla risposta tecnica verificabile.": ["From a photo to a verifiable technical answer.", "De la fotografía a la respuesta técnica verificable.", "Vom Foto zur überprüfbaren technischen Antwort.", "De la photo à la réponse technique vérifiable."],
  "Riconosci il macchinario, leggi la targhetta e consulta i manuali in un unico ambiente progettato per il lavoro sul campo.": [
    "Recognize the machine, read the nameplate and consult the manuals in one workspace designed for field work.",
    "Reconoce la máquina, lee la placa y consulta los manuales en un único entorno diseñado para el trabajo de campo.",
    "Maschine erkennen, Typenschild lesen und Handbücher konsultieren – in einer Umgebung für den Einsatz vor Ort.",
    "Reconnaissez la machine, lisez la plaque signalétique et consultez les manuels dans un seul espace conçu pour le travail sur le terrain.",
  ],
  "Riconoscimento macchina": ["Machine recognition", "Reconocimiento de máquina", "Maschinenerkennung", "Reconnaissance de la machine"],
  "Fonti documentali": ["Document sources", "Fuentes documentales", "Dokumentquellen", "Sources documentaires"],
  "Conoscenza isolata": ["Isolated knowledge", "Conocimiento aislado", "Isoliertes Wissen", "Connaissances isolées"],
  "AI per manutenzione, diagnostica e consultazione tecnica.": ["AI for maintenance, diagnostics and technical reference.", "IA para mantenimiento, diagnóstico y consulta técnica.", "KI für Wartung, Diagnose und technische Recherche.", "IA pour la maintenance, le diagnostic et la consultation technique."],
  "Email": ["Email", "Correo electrónico", "E-Mail", "E-mail"],
  "Password": ["Password", "Contraseña", "Passwort", "Mot de passe"],
  "Bentornato": ["Welcome back", "Bienvenido de nuevo", "Willkommen zurück", "Bon retour"],
  "Accedi": ["Sign in", "Iniciar sesión", "Anmelden", "Se connecter"],
  "Entra nel tuo workspace di assistenza tecnica.": ["Enter your technical support workspace.", "Entra en tu espacio de asistencia técnica.", "Melde dich in deinem technischen Support-Bereich an.", "Accédez à votre espace d'assistance technique."],
  "Password (almeno 8 caratteri)": ["Password (at least 8 characters)", "Contraseña (al menos 8 caracteres)", "Passwort (mindestens 8 Zeichen)", "Mot de passe (au moins 8 caractères)"],
  "Accesso in corso...": ["Signing in...", "Iniciando sesión...", "Anmeldung läuft...", "Connexion en cours..."],
  "Le credenziali te le fornisce il responsabile della tua azienda.": ["Your company manager provides your credentials.", "Las credenciales te las proporciona el responsable de tu empresa.", "Die Zugangsdaten erhältst du von der verantwortlichen Person deines Unternehmens.", "Vos identifiants vous sont fournis par le responsable de votre entreprise."],
  "Password dimenticata?": ["Forgot your password?", "¿Has olvidado la contraseña?", "Passwort vergessen?", "Mot de passe oublié ?"],
  "Recupero accesso": ["Account recovery", "Recuperar acceso", "Zugang wiederherstellen", "Récupération de l'accès"],
  "Password dimenticata": ["Forgot password", "Contraseña olvidada", "Passwort vergessen", "Mot de passe oublié"],
  "Inserisci l’email associata all’account per ricevere le istruzioni.": ["Enter the email linked to your account to receive the instructions.", "Introduce el correo asociado a la cuenta para recibir las instrucciones.", "Gib die mit dem Konto verknüpfte E-Mail-Adresse ein, um die Anleitung zu erhalten.", "Saisissez l'e-mail associé au compte pour recevoir les instructions."],
  "Invio in corso...": ["Sending...", "Enviando...", "Wird gesendet...", "Envoi en cours..."],
  "Invia istruzioni": ["Send instructions", "Enviar instrucciones", "Anleitung senden", "Envoyer les instructions"],
  "Torna al login": ["Back to sign in", "Volver al inicio de sesión", "Zurück zur Anmeldung", "Retour à la connexion"],
  "Verifica in due passaggi": ["Two-step verification", "Verificación en dos pasos", "Zwei-Schritt-Verifizierung", "Vérification en deux étapes"],
  "Ti abbiamo inviato un codice via email. Inseriscilo qui sotto.": ["We sent you a code by email. Enter it below.", "Te hemos enviado un código por correo. Introdúcelo abajo.", "Wir haben dir einen Code per E-Mail gesendet. Gib ihn unten ein.", "Nous vous avons envoyé un code par e-mail. Saisissez-le ci-dessous."],
  "Codice a 6 cifre": ["6-digit code", "Código de 6 cifras", "6-stelliger Code", "Code à 6 chiffres"],
  "Annulla": ["Cancel", "Cancelar", "Abbrechen", "Annuler"],
  "Verifica in corso...": ["Verifying...", "Verificando...", "Wird überprüft...", "Vérification en cours..."],
  "Verifica": ["Verify", "Verificar", "Überprüfen", "Vérifier"],
  "Non hai ricevuto il codice? Invia di nuovo": ["Didn't get the code? Send it again", "¿No has recibido el código? Enviar de nuevo", "Keinen Code erhalten? Erneut senden", "Vous n'avez pas reçu le code ? Renvoyer"],
  "Usa un codice di recupero": ["Use a recovery code", "Usar un código de recuperación", "Wiederherstellungscode verwenden", "Utiliser un code de récupération"],
  "Codice di recupero": ["Recovery code", "Código de recuperación", "Wiederherstellungscode", "Code de récupération"],
  "Inserisci uno dei codici di recupero generati quando hai attivato la 2FA. Ogni codice puo' essere usato una sola volta.": [
    "Enter one of the recovery codes generated when you enabled 2FA. Each code can be used only once.",
    "Introduce uno de los códigos de recuperación generados al activar la 2FA. Cada código solo se puede usar una vez.",
    "Gib einen der Wiederherstellungscodes ein, die beim Aktivieren der 2FA erstellt wurden. Jeder Code kann nur einmal verwendet werden.",
    "Saisissez l'un des codes de récupération générés lors de l'activation de la 2FA. Chaque code ne peut être utilisé qu'une seule fois.",
  ],
  "Accedi con codice di recupero": ["Sign in with recovery code", "Iniciar sesión con código de recuperación", "Mit Wiederherstellungscode anmelden", "Se connecter avec un code de récupération"],
  "Torna al codice via email": ["Back to the email code", "Volver al código por correo", "Zurück zum E-Mail-Code", "Retour au code par e-mail"],
  "Primo accesso": ["First sign-in", "Primer acceso", "Erste Anmeldung", "Premier accès"],
  "Benvenuto": ["Welcome", "Bienvenido", "Willkommen", "Bienvenue"],
  "Il tuo account di {company} è pronto. ": ["Your {company} account is ready. ", "Tu cuenta de {company} está lista. ", "Dein Konto bei {company} ist bereit. ", "Votre compte {company} est prêt. "],
  "Prima di iniziare, leggi e accetta i documenti qui sotto.": ["Before you start, read and accept the documents below.", "Antes de empezar, lee y acepta los documentos de abajo.", "Bevor du beginnst, lies und akzeptiere die folgenden Dokumente.", "Avant de commencer, lisez et acceptez les documents ci-dessous."],
  "Non è stato possibile registrare il consenso. Riprova.": ["Your consent could not be saved. Try again.", "No se ha podido registrar el consentimiento. Inténtalo de nuevo.", "Die Zustimmung konnte nicht gespeichert werden. Versuche es erneut.", "Impossible d'enregistrer le consentement. Réessayez."],
  "Accetto i ": ["I accept the ", "Acepto los ", "Ich akzeptiere die ", "J'accepte les "],
  "Termini di servizio": ["Terms of Service", "Términos del servicio", "Nutzungsbedingungen", "Conditions d'utilisation"],
  " e l’": [" and the ", " y la ", " und die ", " et la "],
  "Informativa sulla privacy": ["Privacy Policy", "Política de privacidad", "Datenschutzerklärung", "Politique de confidentialité"],
  "Salvataggio...": ["Saving...", "Guardando...", "Wird gespeichert...", "Enregistrement..."],
  "Accetta e continua": ["Accept and continue", "Aceptar y continuar", "Akzeptieren und fortfahren", "Accepter et continuer"],
  "Esci": ["Sign out", "Cerrar sesión", "Abmelden", "Se déconnecter"],
  "Nascondi password": ["Hide password", "Ocultar contraseña", "Passwort verbergen", "Masquer le mot de passe"],
  "Mostra password": ["Show password", "Mostrar contraseña", "Passwort anzeigen", "Afficher le mot de passe"],
  "Autenticazione non riuscita.": ["Sign-in failed.", "No se ha podido iniciar sesión.", "Anmeldung fehlgeschlagen.", "Échec de la connexion."],
  "Ti abbiamo inviato un codice via email.": ["We sent you a code by email.", "Te hemos enviado un código por correo.", "Wir haben dir einen Code per E-Mail gesendet.", "Nous vous avons envoyé un code par e-mail."],
  "Ti abbiamo inviato un nuovo codice via email.": ["We sent you a new code by email.", "Te hemos enviado un nuevo código por correo.", "Wir haben dir einen neuen Code per E-Mail gesendet.", "Nous vous avons envoyé un nouveau code par e-mail."],
  "Sessione scaduta.": ["Session expired.", "Sesión caducada.", "Sitzung abgelaufen.", "Session expirée."],
  "Cambio password non riuscito.": ["Password change failed.", "No se ha podido cambiar la contraseña.", "Passwortänderung fehlgeschlagen.", "Échec du changement de mot de passe."],
  "Richiesta non riuscita.": ["Request failed.", "La solicitud ha fallado.", "Anfrage fehlgeschlagen.", "La demande a échoué."],
  "Se l'indirizzo esiste, riceverai un'email con le istruzioni.": ["If the address exists, you will receive an email with the instructions.", "Si la dirección existe, recibirás un correo con las instrucciones.", "Falls die Adresse existiert, erhältst du eine E-Mail mit der Anleitung.", "Si l'adresse existe, vous recevrez un e-mail avec les instructions."],
  "Codice non valido.": ["Invalid code.", "Código no válido.", "Ungültiger Code.", "Code non valide."],
  "Codice di recupero non valido.": ["Invalid recovery code.", "Código de recuperación no válido.", "Ungültiger Wiederherstellungscode.", "Code de récupération non valide."],
  "Impossibile inviare un nuovo codice.": ["Unable to send a new code.", "No se puede enviar un nuevo código.", "Neuer Code kann nicht gesendet werden.", "Impossible d'envoyer un nouveau code."],

  // Main page: header, sidebar, chat dialog
  "Apri navigazione": ["Open navigation", "Abrir navegación", "Navigation öffnen", "Ouvrir la navigation"],
  "Chiudi navigazione": ["Close navigation", "Cerrar navegación", "Navigation schließen", "Fermer la navigation"],
  "Navigazione principale": ["Main navigation", "Navegación principal", "Hauptnavigation", "Navigation principale"],
  "Nuova analisi": ["New analysis", "Nuevo análisis", "Neue Analyse", "Nouvelle analyse"],
  "Conoscenza aziendale": ["Company knowledge", "Conocimiento de la empresa", "Unternehmenswissen", "Connaissances de l'entreprise"],
  "Conoscenza base": ["Base knowledge", "Conocimiento base", "Basiswissen", "Connaissances de base"],
  "Manuali tecnici di base": ["Base technical manuals", "Manuales técnicos básicos", "Technische Basishandbücher", "Manuels techniques de base"],
  "Sistema operativo": ["System online", "Sistema operativo", "System betriebsbereit", "Système opérationnel"],
  "Creazione...": ["Creating...", "Creando...", "Wird erstellt...", "Création..."],
  "Nuova chat": ["New chat", "Nuevo chat", "Neuer Chat", "Nouveau chat"],
  "+ Azienda": ["+ Company", "+ Empresa", "+ Unternehmen", "+ Entreprise"],
  "Chat recenti": ["Recent chats", "Chats recientes", "Letzte Chats", "Chats récents"],
  "Le tue analisi compariranno qui.": ["Your analyses will appear here.", "Tus análisis aparecerán aquí.", "Deine Analysen erscheinen hier.", "Vos analyses apparaîtront ici."],
  "Rinomina chat {title}": ["Rename chat {title}", "Renombrar chat {title}", "Chat {title} umbenennen", "Renommer le chat {title}"],
  "Elimina chat {title}": ["Delete chat {title}", "Eliminar chat {title}", "Chat {title} löschen", "Supprimer le chat {title}"],
  "Eliminazione in corso": ["Deleting", "Eliminando", "Wird gelöscht", "Suppression en cours"],
  "Elimina {title}": ["Delete {title}", "Eliminar {title}", "{title} löschen", "Supprimer {title}"],
  "Documenti aziendali": ["Company documents", "Documentos de la empresa", "Unternehmensdokumente", "Documents de l'entreprise"],
  "Responsabile": ["Manager", "Responsable", "Verantwortlich", "Responsable"],
  "Dipendente": ["Employee", "Empleado", "Mitarbeiter", "Employé"],
  "Sessione autenticata": ["Signed-in session", "Sesión autenticada", "Angemeldete Sitzung", "Session authentifiée"],
  "Account": ["Account", "Cuenta", "Konto", "Compte"],
  "Profilo": ["Profile", "Perfil", "Profil", "Profil"],
  "Il tuo account e la password.": ["Your account and password.", "Tu cuenta y la contraseña.", "Dein Konto und Passwort.", "Votre compte et votre mot de passe."],
  "Chiudi profilo": ["Close profile", "Cerrar perfil", "Profil schließen", "Fermer le profil"],
  "Gestione azienda": ["Company management", "Gestión de la empresa", "Unternehmensverwaltung", "Gestion de l'entreprise"],
  "Chiudi finestra": ["Close window", "Cerrar ventana", "Fenster schließen", "Fermer la fenêtre"],
  "Rinomina chat": ["Rename chat", "Renombrar chat", "Chat umbenennen", "Renommer le chat"],
  "Elimina chat": ["Delete chat", "Eliminar chat", "Chat löschen", "Supprimer le chat"],
  "Scegli un nome breve e riconoscibile per questa conversazione.": ["Choose a short, recognizable name for this conversation.", "Elige un nombre breve y reconocible para esta conversación.", "Wähle einen kurzen, gut erkennbaren Namen für diese Unterhaltung.", "Choisissez un nom court et reconnaissable pour cette conversation."],
  "La chat ": ["The chat ", "El chat ", "Der Chat ", "Le chat "],
  " e tutti i suoi messaggi verranno eliminati definitivamente.": [" and all its messages will be permanently deleted.", " y todos sus mensajes se eliminarán definitivamente.", " und alle zugehörigen Nachrichten werden endgültig gelöscht.", " et tous ses messages seront définitivement supprimés."],
  "Nome della chat": ["Chat name", "Nombre del chat", "Chatname", "Nom du chat"],
  "Questa operazione non può essere annullata.": ["This action cannot be undone.", "Esta operación no se puede deshacer.", "Dieser Vorgang kann nicht rückgängig gemacht werden.", "Cette opération est irréversible."],
  "Salva nome": ["Save name", "Guardar nombre", "Namen speichern", "Enregistrer le nom"],
  "Elimina definitivamente": ["Delete permanently", "Eliminar definitivamente", "Endgültig löschen", "Supprimer définitivement"],
  "Non è stato possibile eliminare la chat.": ["The chat could not be deleted.", "No se ha podido eliminar el chat.", "Der Chat konnte nicht gelöscht werden.", "Impossible de supprimer le chat."],
  "Non è stato possibile rinominare la chat.": ["The chat could not be renamed.", "No se ha podido renombrar el chat.", "Der Chat konnte nicht umbenannt werden.", "Impossible de renommer le chat."],
  "Stai usando la password temporanea ricevuta. Puoi cambiarla quando vuoi dal tuo profilo.": ["You are using the temporary password you received. You can change it anytime from your profile.", "Estás usando la contraseña temporal recibida. Puedes cambiarla cuando quieras desde tu perfil.", "Du verwendest das erhaltene temporäre Passwort. Du kannst es jederzeit in deinem Profil ändern.", "Vous utilisez le mot de passe temporaire reçu. Vous pouvez le modifier à tout moment depuis votre profil."],
  "Cambia password": ["Change password", "Cambiar contraseña", "Passwort ändern", "Changer le mot de passe"],
  "Nascondi avviso": ["Hide notice", "Ocultar aviso", "Hinweis ausblenden", "Masquer l'avis"],

  // Composer, progress, answer
  "Analizza un macchinario": ["Analyze a machine", "Analiza una máquina", "Maschine analysieren", "Analyser une machine"],
  "Carica una fotografia e fai una domanda tecnica. L’assistente riconoscerà la macchina e consulterà la documentazione disponibile.": [
    "Upload a photo and ask a technical question. The assistant will recognize the machine and consult the available documentation.",
    "Sube una fotografía y haz una pregunta técnica. El asistente reconocerá la máquina y consultará la documentación disponible.",
    "Lade ein Foto hoch und stelle eine technische Frage. Der Assistent erkennt die Maschine und durchsucht die verfügbare Dokumentation.",
    "Téléversez une photo et posez une question technique. L'assistant reconnaîtra la machine et consultera la documentation disponible.",
  ],
  "Anteprima immagine caricata": ["Preview of the uploaded image", "Vista previa de la imagen subida", "Vorschau des hochgeladenen Bildes", "Aperçu de l'image téléversée"],
  "Sostituisci immagine": ["Replace image", "Sustituir imagen", "Bild ersetzen", "Remplacer l'image"],
  "Rimuovi immagine": ["Remove image", "Quitar imagen", "Bild entfernen", "Supprimer l'image"],
  "Trascina una foto della macchina": ["Drag a photo of the machine", "Arrastra una foto de la máquina", "Foto der Maschine hierher ziehen", "Faites glisser une photo de la machine"],
  "oppure tocca per usare fotocamera o galleria": ["or tap to use the camera or gallery", "o toca para usar la cámara o la galería", "oder tippen, um Kamera oder Galerie zu verwenden", "ou touchez pour utiliser l'appareil photo ou la galerie"],
  "Scegli immagine": ["Choose image", "Elegir imagen", "Bild auswählen", "Choisir une image"],
  "Domanda tecnica": ["Technical question", "Pregunta técnica", "Technische Frage", "Question technique"],
  "Chiedi qualcosa sulla macchina...": ["Ask something about the machine...", "Pregunta algo sobre la máquina...", "Frag etwas zur Maschine...", "Posez une question sur la machine..."],
  "Cambia foto": ["Change photo", "Cambiar foto", "Foto ändern", "Changer de photo"],
  "Foto": ["Photo", "Foto", "Foto", "Photo"],
  "Analisi in corso...": ["Analyzing...", "Analizando...", "Analyse läuft...", "Analyse en cours..."],
  "Analizza e rispondi": ["Analyze and answer", "Analizar y responder", "Analysieren und antworten", "Analyser et répondre"],
  "Dettatura non riuscita.": ["Dictation failed.", "Dictado fallido.", "Diktat fehlgeschlagen.", "Échec de la dictée."],
  "Analisi non completata.": ["Analysis not completed.", "Análisis no completado.", "Analyse nicht abgeschlossen.", "Analyse non terminée."],
  "Interrompi dettatura": ["Stop dictation", "Detener dictado", "Diktat beenden", "Arrêter la dictée"],
  "Trascrizione in corso": ["Transcribing", "Transcribiendo", "Wird transkribiert", "Transcription en cours"],
  "Detta la domanda": ["Dictate the question", "Dictar la pregunta", "Frage diktieren", "Dicter la question"],
  "Trascrivo...": ["Transcribing...", "Transcribiendo...", "Transkribiere...", "Transcription..."],
  "Detta": ["Dictate", "Dictar", "Diktieren", "Dicter"],
  "Carica un'immagine prima di inviare.": ["Upload an image before sending.", "Sube una imagen antes de enviar.", "Lade vor dem Senden ein Bild hoch.", "Téléversez une image avant d'envoyer."],
  "Errore inatteso.": ["Unexpected error.", "Error inesperado.", "Unerwarteter Fehler.", "Erreur inattendue."],
  "Nessun audio registrato.": ["No audio recorded.", "No se ha grabado audio.", "Kein Audio aufgenommen.", "Aucun audio enregistré."],
  "Trascrizione non riuscita.": ["Transcription failed.", "Transcripción fallida.", "Transkription fehlgeschlagen.", "Échec de la transcription."],
  "Permesso microfono negato.": ["Microphone permission denied.", "Permiso de micrófono denegado.", "Mikrofonzugriff verweigert.", "Autorisation du micro refusée."],
  "Microfono non disponibile.": ["Microphone not available.", "Micrófono no disponible.", "Mikrofon nicht verfügbar.", "Micro non disponible."],
  "Riconoscimento": ["Recognition", "Reconocimiento", "Erkennung", "Reconnaissance"],
  "OCR targhetta": ["Nameplate OCR", "OCR de la placa", "Typenschild-OCR", "OCR de la plaque"],
  "Ricerca documentazione": ["Documentation search", "Búsqueda de documentación", "Dokumentationssuche", "Recherche documentaire"],
  "Risposta tecnica": ["Technical answer", "Respuesta técnica", "Technische Antwort", "Réponse technique"],
  "Analisi della macchina in corso": ["Analyzing the machine", "Analizando la máquina", "Maschine wird analysiert", "Analyse de la machine en cours"],
  "La prima richiesta può richiedere più tempo per caricare i modelli.": ["The first request may take longer while the models load.", "La primera solicitud puede tardar más mientras se cargan los modelos.", "Die erste Anfrage kann länger dauern, da die Modelle geladen werden.", "La première requête peut prendre plus de temps, le temps de charger les modèles."],
  "Il processo include: {phases}": ["The process includes: {phases}", "El proceso incluye: {phases}", "Der Ablauf umfasst: {phases}", "Le processus comprend : {phases}"],
  "n/d": ["n/a", "n/d", "k. A.", "n/d"],
  "Macchina non riconosciuta": ["Machine not recognized", "Máquina no reconocida", "Maschine nicht erkannt", "Machine non reconnue"],
  "La soglia di riconoscimento non è stata superata.": ["The recognition threshold was not reached.", "No se ha superado el umbral de reconocimiento.", "Die Erkennungsschwelle wurde nicht erreicht.", "Le seuil de reconnaissance n'a pas été atteint."],
  "Prova una foto più nitida, ben illuminata e con la macchina interamente visibile.": ["Try a sharper, well-lit photo with the whole machine visible.", "Prueba con una foto más nítida, bien iluminada y con la máquina entera visible.", "Versuche ein schärferes, gut beleuchtetes Foto, auf dem die ganze Maschine zu sehen ist.", "Essayez une photo plus nette, bien éclairée, avec la machine entièrement visible."],
  "Macchina riconosciuta": ["Machine recognized", "Máquina reconocida", "Maschine erkannt", "Machine reconnue"],
  "Confidenza": ["Confidence", "Confianza", "Konfidenz", "Confiance"],
  "Nessuna risposta disponibile.": ["No answer available.", "No hay respuesta disponible.", "Keine Antwort verfügbar.", "Aucune réponse disponible."],
  "Interrompi lettura": ["Stop reading", "Detener lectura", "Vorlesen beenden", "Arrêter la lecture"],
  "Ascolta la risposta": ["Listen to the answer", "Escuchar la respuesta", "Antwort anhören", "Écouter la réponse"],
  "Preparo...": ["Preparing...", "Preparando...", "Wird vorbereitet...", "Préparation..."],
  "Ascolta": ["Listen", "Escuchar", "Anhören", "Écouter"],
  "Lettura non riuscita.": ["Reading failed.", "Lectura fallida.", "Vorlesen fehlgeschlagen.", "Échec de la lecture."],
  "Riproduzione non riuscita.": ["Playback failed.", "Reproducción fallida.", "Wiedergabe fehlgeschlagen.", "Échec de la lecture audio."],

  // Nameplate, sources, diagnostics, history
  "Modello": ["Model", "Modelo", "Modell", "Modèle"],
  "Matricola / seriale": ["Serial number", "Número de serie", "Seriennummer", "Numéro de série"],
  "Asset tag": ["Asset tag", "Etiqueta de activo", "Inventarnummer", "Étiquette d'inventaire"],
  "Dati targhetta": ["Nameplate data", "Datos de la placa", "Typenschilddaten", "Données de la plaque"],
  "Testo rilevato": ["Detected text", "Texto detectado", "Erkannter Text", "Texte détecté"],
  "Nessun dato leggibile trovato sulla targhetta.": ["No readable data found on the nameplate.", "No se han encontrado datos legibles en la placa.", "Auf dem Typenschild wurden keine lesbaren Daten gefunden.", "Aucune donnée lisible trouvée sur la plaque."],
  "OCR non disponibile": ["OCR not available", "OCR no disponible", "OCR nicht verfügbar", "OCR non disponible"],
  "Copia {label}": ["Copy {label}", "Copiar {label}", "{label} kopieren", "Copier {label}"],
  "Fonti consultate": ["Sources consulted", "Fuentes consultadas", "Konsultierte Quellen", "Sources consultées"],
  "Nessuna fonte documentale disponibile per questa risposta.": ["No document source available for this answer.", "No hay fuentes documentales disponibles para esta respuesta.", "Für diese Antwort ist keine Dokumentquelle verfügbar.", "Aucune source documentaire disponible pour cette réponse."],
  "Fonte {n}": ["Source {n}", "Fuente {n}", "Quelle {n}", "Source {n}"],
  "Documento aziendale": ["Company document", "Documento de la empresa", "Unternehmensdokument", "Document de l'entreprise"],
  "Manuale generale": ["General manual", "Manual general", "Allgemeines Handbuch", "Manuel général"],
  "Pagina {page}": ["Page {page}", "Página {page}", "Seite {page}", "Page {page}"],
  "Passaggio {n}": ["Passage {n}", "Pasaje {n}", "Abschnitt {n}", "Passage {n}"],
  "Rilevanza {score}": ["Relevance {score}", "Relevancia {score}", "Relevanz {score}", "Pertinence {score}"],
  "Dettagli diagnostici · {count} candidati visivi": ["Diagnostic details · {count} visual candidates", "Detalles de diagnóstico · {count} candidatos visuales", "Diagnosedetails · {count} visuelle Kandidaten", "Détails de diagnostic · {count} candidats visuels"],
  "Conversazione": ["Conversation", "Conversación", "Unterhaltung", "Conversation"],
  "Tu": ["You", "Tú", "Du", "Vous"],
  "Assistente": ["Assistant", "Asistente", "Assistent", "Assistant"],
  "Oggi": ["Today", "Hoy", "Heute", "Aujourd'hui"],
  "Ieri": ["Yesterday", "Ayer", "Gestern", "Hier"],
  "Ricerche precedenti": ["Previous searches", "Búsquedas anteriores", "Frühere Suchen", "Recherches précédentes"],
  "Analisi generale della foto": ["General photo analysis", "Análisis general de la foto", "Allgemeine Fotoanalyse", "Analyse générale de la photo"],
  "Analisi non riuscita": ["Analysis failed", "Análisis fallido", "Analyse fehlgeschlagen", "Échec de l'analyse"],
  "Risposta": ["Answer", "Respuesta", "Antwort", "Réponse"],
  "Esito": ["Outcome", "Resultado", "Ergebnis", "Résultat"],
  "Errore": ["Error", "Error", "Fehler", "Erreur"],
  "Non riconosciuta": ["Not recognized", "No reconocida", "Nicht erkannt", "Non reconnue"],
  "Riconosciuta": ["Recognized", "Reconocida", "Erkannt", "Reconnue"],
  "Confidenza {pct}%": ["Confidence {pct}%", "Confianza {pct}%", "Konfidenz {pct}%", "Confiance {pct}%"],
  "p. {page}": ["p. {page}", "p. {page}", "S. {page}", "p. {page}"],

  // Company documents panel and notification
  "Fonti disponibili per le chat aziendali.": ["Sources available for company chats.", "Fuentes disponibles para los chats de empresa.", "Verfügbare Quellen für Unternehmenschats.", "Sources disponibles pour les chats d'entreprise."],
  "Chiudi pannello documenti": ["Close documents panel", "Cerrar panel de documentos", "Dokumentbereich schließen", "Fermer le panneau des documents"],
  "Indicizzato": ["Indexed", "Indexado", "Indiziert", "Indexé"],
  "In elaborazione": ["Processing", "En proceso", "In Bearbeitung", "En cours de traitement"],
  "Non indicizzato": ["Not indexed", "No indexado", "Nicht indiziert", "Non indexé"],
  "Selezione per la prossima chat": ["Selection for the next chat", "Selección para el próximo chat", "Auswahl für den nächsten Chat", "Sélection pour le prochain chat"],
  "La casella include il PDF nella conoscenza aziendale. Il cestino elimina invece il file definitivamente.": [
    "The checkbox adds the PDF to the company knowledge. The bin deletes the file permanently.",
    "La casilla incluye el PDF en el conocimiento de la empresa. La papelera, en cambio, elimina el archivo definitivamente.",
    "Das Kästchen nimmt das PDF in das Unternehmenswissen auf. Der Papierkorb löscht die Datei dagegen endgültig.",
    "La case ajoute le PDF aux connaissances de l'entreprise. La corbeille supprime en revanche le fichier définitivement.",
  ],
  "La casella include il PDF nella conoscenza aziendale della prossima chat.": ["The checkbox adds the PDF to the company knowledge of the next chat.", "La casilla incluye el PDF en el conocimiento de la empresa del próximo chat.", "Das Kästchen nimmt das PDF in das Unternehmenswissen des nächsten Chats auf.", "La case ajoute le PDF aux connaissances de l'entreprise du prochain chat."],
  "Gestisci indicizzazione e archivio": ["Manage indexing and archive", "Gestionar indexación y archivo", "Indizierung und Archiv verwalten", "Gérer l'indexation et l'archive"],
  "I documenti sono gestiti dal responsabile della tua azienda.": ["Documents are managed by your company manager.", "Los documentos los gestiona el responsable de tu empresa.", "Die Dokumente werden von der verantwortlichen Person deines Unternehmens verwaltet.", "Les documents sont gérés par le responsable de votre entreprise."],
  "Nessun documento aziendale": ["No company documents", "Ningún documento de la empresa", "Keine Unternehmensdokumente", "Aucun document d'entreprise"],
  "Carica un PDF tecnico per renderlo disponibile nelle nuove chat aziendali.": ["Upload a technical PDF to make it available in new company chats.", "Sube un PDF técnico para que esté disponible en los nuevos chats de empresa.", "Lade ein technisches PDF hoch, um es in neuen Unternehmenschats verfügbar zu machen.", "Téléversez un PDF technique pour le rendre disponible dans les nouveaux chats d'entreprise."],
  "Il responsabile della tua azienda non ha ancora caricato documenti.": ["Your company manager has not uploaded any documents yet.", "El responsable de tu empresa aún no ha subido documentos.", "Die verantwortliche Person deines Unternehmens hat noch keine Dokumente hochgeladen.", "Le responsable de votre entreprise n'a pas encore téléversé de documents."],
  "Includi {file} nella prossima chat aziendale": ["Include {file} in the next company chat", "Incluir {file} en el próximo chat de empresa", "{file} in den nächsten Unternehmenschat aufnehmen", "Inclure {file} dans le prochain chat d'entreprise"],
  "Rimuovi {file} dalla memoria RAG": ["Remove {file} from the RAG memory", "Quitar {file} de la memoria RAG", "{file} aus dem RAG-Speicher entfernen", "Retirer {file} de la mémoire RAG"],
  "Rimuovere definitivamente \"{file}\" dalla memoria RAG?": ["Permanently remove \"{file}\" from the RAG memory?", "¿Quitar definitivamente \"{file}\" de la memoria RAG?", "\"{file}\" endgültig aus dem RAG-Speicher entfernen?", "Retirer définitivement « {file} » de la mémoire RAG ?"],
  "Caricamento e indicizzazione...": ["Uploading and indexing...", "Subiendo e indexando...", "Hochladen und Indizieren...", "Téléversement et indexation..."],
  "Carica un nuovo PDF": ["Upload a new PDF", "Subir un nuevo PDF", "Neues PDF hochladen", "Téléverser un nouveau PDF"],
  "Carica documento PDF aziendale": ["Upload company PDF document", "Subir documento PDF de la empresa", "Unternehmens-PDF hochladen", "Téléverser un document PDF d'entreprise"],
  "Il pannello può restare aperto durante l’indicizzazione.": ["The panel can stay open while indexing.", "El panel puede quedar abierto durante la indexación.", "Der Bereich kann während der Indizierung geöffnet bleiben.", "Le panneau peut rester ouvert pendant l'indexation."],
  "Eliminazione del documento non riuscita.": ["The document could not be deleted.", "No se ha podido eliminar el documento.", "Das Dokument konnte nicht gelöscht werden.", "Impossible de supprimer le document."],
  "Documento indicizzato": ["Document indexed", "Documento indexado", "Dokument indiziert", "Document indexé"],
  "Chiudi notifica": ["Close notification", "Cerrar notificación", "Benachrichtigung schließen", "Fermer la notification"],
};

const COLUMN: Record<Exclude<AnswerLanguage, "it">, number> = { en: 0, es: 1, de: 2, fr: 3 };

/** Locale for dates and times shown in the interface. */
export const LOCALES: Record<AnswerLanguage, string> = { it: "it-IT", en: "en-GB", es: "es-ES", de: "de-DE", fr: "fr-FR" };

export type Translate = (text: string, values?: Record<string, string | number>) => string;

export function translate(language: AnswerLanguage, text: string, values?: Record<string, string | number>): string {
  const translated = language === "it" ? text : (TRANSLATIONS[text]?.[COLUMN[language]] ?? text);
  return values ? translated.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match)) : translated;
}

/** Translates in the language currently chosen, for messages created outside rendering (hooks, handlers). */
export const tr: Translate = (text, values) => translate(getAnswerLanguage(), text, values);

// The chosen language lives in localStorage; components subscribe to changes so
// the whole page switches as soon as the selector changes, without a provider.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function changeLanguage(language: AnswerLanguage) {
  setAnswerLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
  listeners.forEach((listener) => listener());
}

export function useLanguage() {
  // Server rendering has no localStorage: it renders Italian and the client switches after hydration.
  const language = useSyncExternalStore(subscribe, getAnswerLanguage, () => DEFAULT_ANSWER_LANGUAGE);
  const t: Translate = (text, values) => translate(language, text, values);
  return { language, t, changeLanguage };
}
