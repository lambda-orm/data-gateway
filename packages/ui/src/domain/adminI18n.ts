import { format, Locale } from './i18n'

/** The texts of the administration of the workspaces (the schema in YAML, new and removed schemas); {name} is replaced */
export interface AdminMessages {
	schemaFile: string
	save: string
	saving: string
	saved: string
	unsaved: string
	readOnlySchema: string
	errorsCount: string
	warningsCount: string
	noIssues: string
	invalidNotSaved: string
	conflict: string
	changedOnGateway: string
	updatedFromGateway: string
	theirs: string
	mine: string
	keepMine: string
	takeTheirs: string
	newSchema: string
	route: string
	routeHint: string
	startFrom: string
	emptySchema: string
	copyOf: string
	create: string
	cancel: string
	created: string
	removeSchema: string
	removeConfirm: string
	remove: string
	removed: string
	browserItems: string
	copyToWorkspace: string
	copiedToWorkspace: string
	unreadableFiles: string
	commands: string
	stage: string
	preview: string
	runNamed: string
	force: string
	typeStage: string
	willRun: string
	nothingToRun: string
	rowsToWrite: string
	chooseExport: string
	saveToData: string
	download: string
	jobs: string
	noJobs: string
	running: string
	done: string
	failed: string
	savedIn: string
	inStep: string
	schemaChanges: string
	linesChanged: string
	dataFile: string
	entityOfData: string
	incorporateNote: string
	forms: string
	entities: string
	enums: string
	sources: string
	mappings: string
	stages: string
	newNamed: string
	rename: string
	usedBy: string
	changedMeanwhile: string
	addRow: string
	nothingSelected: string
}

type Row = [keyof AdminMessages, ...string[]]

const ROWS: Row[] = [
	['schemaFile', 'Schema (lambdaORM.yaml)', 'Esquema (lambdaORM.yaml)', 'Esquema (lambdaORM.yaml)', 'Schéma (lambdaORM.yaml)', 'Schema (lambdaORM.yaml)', 'Schema (lambdaORM.yaml)', 'Schema (lambdaORM.yaml)', 'Esquema (lambdaORM.yaml)', 'Esquema (lambdaORM.yaml)', 'Eskema (lambdaORM.yaml)'],
	['save', 'Save', 'Guardar', 'Salvar', 'Enregistrer', 'Salva', 'Speichern', 'Opslaan', 'Desa', 'Gardar', 'Gorde'],
	['saving', 'Saving…', 'Guardando…', 'Salvando…', 'Enregistrement…', 'Salvataggio…', 'Wird gespeichert…', 'Opslaan…', 'Desant…', 'Gardando…', 'Gordetzen…'],
	['saved', 'Saved: the gateway reloads the schema', 'Guardado: la gateway recarga el esquema', 'Salvo: a gateway recarrega o esquema', 'Enregistré : la passerelle recharge le schéma', 'Salvato: il gateway ricarica lo schema', 'Gespeichert: das Gateway lädt das Schema neu', 'Opgeslagen: de gateway laadt het schema opnieuw', 'Desat: la passarel·la recarrega l’esquema', 'Gardado: a pasarela recarga o esquema', 'Gordeta: pasabideak eskema berriz kargatzen du'],
	['unsaved', 'Unsaved changes', 'Cambios sin guardar', 'Alterações não salvas', 'Modifications non enregistrées', 'Modifiche non salvate', 'Ungespeicherte Änderungen', 'Niet-opgeslagen wijzigingen', 'Canvis sense desar', 'Cambios sen gardar', 'Gorde gabeko aldaketak'],
	['readOnlySchema', 'Read only: this credential can’t change the schema', 'Solo lectura: esta credencial no puede cambiar el esquema', 'Somente leitura: esta credencial não pode alterar o esquema', 'Lecture seule : cet identifiant ne peut pas modifier le schéma', 'Sola lettura: questa credenziale non può modificare lo schema', 'Nur lesen: diese Anmeldung kann das Schema nicht ändern', 'Alleen lezen: deze referentie kan het schema niet wijzigen', 'Només lectura: aquesta credencial no pot canviar l’esquema', 'Só lectura: esta credencial non pode cambiar o esquema', 'Irakurtzeko soilik: kredentzial honek ezin du eskema aldatu'],
	['errorsCount', '{n} errors', '{n} errores', '{n} erros', '{n} erreurs', '{n} errori', '{n} Fehler', '{n} fouten', '{n} errors', '{n} erros', '{n} errore'],
	['warningsCount', '{n} warnings', '{n} advertencias', '{n} avisos', '{n} avertissements', '{n} avvisi', '{n} Warnungen', '{n} waarschuwingen', '{n} avisos', '{n} avisos', '{n} ohar'],
	['noIssues', 'Valid', 'Válido', 'Válido', 'Valide', 'Valido', 'Gültig', 'Geldig', 'Vàlid', 'Válido', 'Baliozkoa'],
	['invalidNotSaved', 'Not saved: the schema has errors', 'No se guardó: el esquema tiene errores', 'Não salvo: o esquema tem erros', 'Non enregistré : le schéma a des erreurs', 'Non salvato: lo schema ha errori', 'Nicht gespeichert: das Schema hat Fehler', 'Niet opgeslagen: het schema bevat fouten', 'No s’ha desat: l’esquema té errors', 'Non se gardou: o esquema ten erros', 'Ez da gorde: eskemak erroreak ditu'],
	['conflict', 'Someone else saved a new version while you were editing', 'Alguien más guardó una versión nueva mientras editabas', 'Outra pessoa salvou uma versão nova enquanto você editava', 'Quelqu’un d’autre a enregistré une nouvelle version pendant votre édition', 'Qualcun altro ha salvato una nuova versione mentre modificavi', 'Jemand anderes hat während deiner Bearbeitung eine neue Version gespeichert', 'Iemand anders heeft een nieuwe versie opgeslagen terwijl je bewerkte', 'Algú altre ha desat una versió nova mentre editaves', 'Alguén máis gardou unha versión nova mentres editabas', 'Beste norbaitek bertsio berri bat gorde du editatzen ari zinen bitartean'],
	['changedOnGateway', 'The schema changed on the gateway; you have unsaved changes', 'El esquema cambió en la gateway; tenés cambios sin guardar', 'O esquema mudou na gateway; você tem alterações não salvas', 'Le schéma a changé sur la passerelle ; vous avez des modifications non enregistrées', 'Lo schema è cambiato sul gateway; hai modifiche non salvate', 'Das Schema hat sich im Gateway geändert; du hast ungespeicherte Änderungen', 'Het schema is gewijzigd op de gateway; je hebt niet-opgeslagen wijzigingen', 'L’esquema ha canviat a la passarel·la; tens canvis sense desar', 'O esquema cambiou na pasarela; tes cambios sen gardar', 'Eskema aldatu da pasabidean; gorde gabeko aldaketak dituzu'],
	['updatedFromGateway', 'Updated with the version on the gateway', 'Actualizado con la versión de la gateway', 'Atualizado com a versão da gateway', 'Mis à jour avec la version de la passerelle', 'Aggiornato con la versione del gateway', 'Mit der Version des Gateways aktualisiert', 'Bijgewerkt met de versie op de gateway', 'Actualitzat amb la versió de la passarel·la', 'Actualizado coa versión da pasarela', 'Pasabideko bertsioarekin eguneratuta'],
	['theirs', 'On the gateway', 'En la gateway', 'Na gateway', 'Sur la passerelle', 'Sul gateway', 'Im Gateway', 'Op de gateway', 'A la passarel·la', 'Na pasarela', 'Pasabidean'],
	['mine', 'Yours', 'El tuyo', 'O seu', 'Le vôtre', 'Il tuo', 'Deine', 'Die van jou', 'El teu', 'O teu', 'Zurea'],
	['keepMine', 'Save mine over it', 'Guardar el mío encima', 'Salvar o meu por cima', 'Enregistrer le mien par-dessus', 'Salva il mio sopra', 'Meine darüber speichern', 'Die van mij eroverheen opslaan', 'Desa el meu a sobre', 'Gardar o meu enriba', 'Gorde nirea gainetik'],
	['takeTheirs', 'Take the one on the gateway', 'Tomar el de la gateway', 'Usar o da gateway', 'Prendre celui de la passerelle', 'Prendi quello del gateway', 'Die des Gateways übernehmen', 'Die van de gateway nemen', 'Pren el de la passarel·la', 'Tomar o da pasarela', 'Hartu pasabidekoa'],
	['newSchema', 'New schema', 'Nuevo esquema', 'Novo esquema', 'Nouveau schéma', 'Nuovo schema', 'Neues Schema', 'Nieuw schema', 'Esquema nou', 'Novo esquema', 'Eskema berria'],
	['route', 'Route', 'Ruta', 'Rota', 'Route', 'Percorso', 'Route', 'Route', 'Ruta', 'Ruta', 'Bidea'],
	['routeHint', 'Like sales/v1: letters, digits, _ . - and / between parts', 'Como ventas/v1: letras, dígitos, _ . - y / entre partes', 'Como vendas/v1: letras, dígitos, _ . - e / entre partes', 'Comme ventes/v1 : lettres, chiffres, _ . - et / entre les parties', 'Come vendite/v1: lettere, cifre, _ . - e / tra le parti', 'Wie verkauf/v1: Buchstaben, Ziffern, _ . - und / zwischen Teilen', 'Zoals verkoop/v1: letters, cijfers, _ . - en / tussen delen', 'Com vendes/v1: lletres, dígits, _ . - i / entre parts', 'Como vendas/v1: letras, díxitos, _ . - e / entre partes', 'salmentak/v1 bezala: letrak, digituak, _ . - eta / zatien artean'],
	['startFrom', 'Start from', 'Empezar desde', 'Começar de', 'Partir de', 'Parti da', 'Beginnen mit', 'Beginnen met', 'Comença des de', 'Comezar desde', 'Hasi hemendik'],
	['emptySchema', 'an empty schema', 'un esquema vacío', 'um esquema vazio', 'un schéma vide', 'uno schema vuoto', 'einem leeren Schema', 'een leeg schema', 'un esquema buit', 'un esquema baleiro', 'eskema huts bat'],
	['copyOf', 'a copy of {name}', 'una copia de {name}', 'uma cópia de {name}', 'une copie de {name}', 'una copia di {name}', 'einer Kopie von {name}', 'een kopie van {name}', 'una còpia de {name}', 'unha copia de {name}', '{name}-ren kopia bat'],
	['create', 'Create', 'Crear', 'Criar', 'Créer', 'Crea', 'Erstellen', 'Aanmaken', 'Crea', 'Crear', 'Sortu'],
	['cancel', 'Cancel', 'Cancelar', 'Cancelar', 'Annuler', 'Annulla', 'Abbrechen', 'Annuleren', 'Cancel·la', 'Cancelar', 'Utzi'],
	['created', 'Schema {name} created: it starts in a moment', 'Esquema {name} creado: arranca en un momento', 'Esquema {name} criado: inicia em um momento', 'Schéma {name} créé : il démarre dans un instant', 'Schema {name} creato: parte tra un momento', 'Schema {name} erstellt: es startet gleich', 'Schema {name} aangemaakt: het start zo', 'Esquema {name} creat: arrenca en un moment', 'Esquema {name} creado: arrinca nun momento', '{name} eskema sortuta: laster abiatuko da'],
	['removeSchema', 'Remove the schema', 'Eliminar el esquema', 'Remover o esquema', 'Supprimer le schéma', 'Rimuovi lo schema', 'Schema entfernen', 'Schema verwijderen', 'Elimina l’esquema', 'Eliminar o esquema', 'Kendu eskema'],
	['removeConfirm', 'The workspace of {name} goes to .trash of the volume (nothing is deleted). Type its route to confirm:', 'El workspace de {name} va a .trash del volumen (no se borra nada). Escribí su ruta para confirmar:', 'O workspace de {name} vai para .trash do volume (nada é apagado). Digite a rota para confirmar:', 'L’espace de travail de {name} va dans .trash du volume (rien n’est effacé). Tapez sa route pour confirmer :', 'Il workspace di {name} va in .trash del volume (non si cancella nulla). Scrivi il percorso per confermare:', 'Der Workspace von {name} kommt nach .trash des Volumes (nichts wird gelöscht). Gib die Route zur Bestätigung ein:', 'De workspace van {name} gaat naar .trash van het volume (er wordt niets gewist). Typ de route om te bevestigen:', 'El workspace de {name} va a .trash del volum (no s’esborra res). Escriu la ruta per confirmar:', 'O workspace de {name} vai a .trash do volume (non se borra nada). Escribe a ruta para confirmar:', '{name}-ren workspace-a bolumenaren .trash-era doa (ez da ezer ezabatzen). Idatzi bidea berresteko:'],
	['remove', 'Remove', 'Eliminar', 'Remover', 'Supprimer', 'Rimuovi', 'Entfernen', 'Verwijderen', 'Elimina', 'Eliminar', 'Kendu'],
	['removed', 'Schema {name} removed (its workspace is in .trash)', 'Esquema {name} eliminado (su workspace está en .trash)', 'Esquema {name} removido (o workspace está em .trash)', 'Schéma {name} supprimé (son espace de travail est dans .trash)', 'Schema {name} rimosso (il workspace è in .trash)', 'Schema {name} entfernt (sein Workspace liegt in .trash)', 'Schema {name} verwijderd (de workspace staat in .trash)', 'Esquema {name} eliminat (el workspace és a .trash)', 'Esquema {name} eliminado (o seu workspace está en .trash)', '{name} eskema kenduta (bere workspace-a .trash-en dago)']
]

ROWS.push(
	['forms', 'Schema (forms)', 'Esquema (formularios)', 'Esquema (formulários)', 'Schéma (formulaires)', 'Schema (moduli)', 'Schema (Formulare)', 'Schema (formulieren)', 'Esquema (formularis)', 'Esquema (formularios)', 'Eskema (inprimakiak)'],
	['entities', 'Entities', 'Entidades', 'Entidades', 'Entités', 'Entità', 'Entitäten', 'Entiteiten', 'Entitats', 'Entidades', 'Entitateak'],
	['enums', 'Enums', 'Enums', 'Enums', 'Énumérations', 'Enum', 'Enums', 'Enums', 'Enums', 'Enums', 'Enumak'],
	['sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sorgenti', 'Quellen', 'Bronnen', 'Fonts', 'Fontes', 'Iturriak'],
	['mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mapping', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mapping-ak'],
	['stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stage', 'Stages', 'Stages', 'Stages', 'Stages', 'Stage-ak'],
	['newNamed', 'New in {name}', 'Nuevo en {name}', 'Novo em {name}', 'Nouveau dans {name}', 'Nuovo in {name}', 'Neu in {name}', 'Nieuw in {name}', 'Nou a {name}', 'Novo en {name}', 'Berria {name}-n'],
	['rename', 'Rename', 'Renombrar', 'Renomear', 'Renommer', 'Rinomina', 'Umbenennen', 'Hernoemen', 'Canvia el nom', 'Renomear', 'Berrizendatu'],
	['usedBy', '{name} is used by:', '{name} lo usan:', '{name} é usado por:', '{name} est utilisé par :', '{name} è usato da:', '{name} wird verwendet von:', '{name} wordt gebruikt door:', '{name} l’usen:', '{name} úsano:', '{name} hauek erabiltzen dute:'],
	['changedMeanwhile', 'Someone else changed it meanwhile: this is what it has now', 'Alguien más lo cambió mientras tanto: esto es lo que tiene ahora', 'Outra pessoa alterou enquanto isso: isto é o que tem agora', 'Quelqu’un d’autre l’a modifié entre-temps : voici ce qu’il contient', 'Qualcun altro l’ha cambiato nel frattempo: ecco cosa contiene ora', 'Jemand anderes hat es inzwischen geändert: das ist der aktuelle Stand', 'Iemand anders heeft het intussen gewijzigd: dit is wat het nu bevat', 'Algú altre l’ha canviat mentrestant: això és el que té ara', 'Alguén máis cambiouno mentres tanto: isto é o que ten agora', 'Beste norbaitek aldatu du bitartean: hau da orain duena'],
	['addRow', 'Add', 'Agregar', 'Adicionar', 'Ajouter', 'Aggiungi', 'Hinzufügen', 'Toevoegen', 'Afegeix', 'Engadir', 'Gehitu'],
	['nothingSelected', 'Choose an element on the left, or create one with +', 'Elegí un elemento a la izquierda, o creá uno con +', 'Escolha um elemento à esquerda, ou crie um com +', 'Choisissez un élément à gauche, ou créez-en un avec +', 'Scegli un elemento a sinistra, o creane uno con +', 'Wähle links ein Element oder erstelle eins mit +', 'Kies links een element, of maak er een met +', 'Tria un element a l’esquerra, o crea’n un amb +', 'Escolle un elemento á esquerda, ou crea un con +', 'Aukeratu elementu bat ezkerrean, edo sortu bat + erabiliz'],
	['schemaChanges', 'What {name} will change in lambdaORM.yaml (stage {stage})', 'Lo que {name} va a cambiar en lambdaORM.yaml (stage {stage})', 'O que {name} vai mudar em lambdaORM.yaml (stage {stage})', 'Ce que {name} changera dans lambdaORM.yaml (stage {stage})', 'Cosa cambierà {name} in lambdaORM.yaml (stage {stage})', 'Was {name} in lambdaORM.yaml ändert (Stage {stage})', 'Wat {name} in lambdaORM.yaml wijzigt (stage {stage})', 'El que {name} canviarà a lambdaORM.yaml (stage {stage})', 'O que {name} vai cambiar en lambdaORM.yaml (stage {stage})', '{name}-ek lambdaORM.yaml-n aldatuko duena (stage {stage})'],
	['linesChanged', '+{added} −{removed} lines; the rest of the file (and its comments) stays as it is', '+{added} −{removed} líneas; el resto del archivo (y sus comentarios) queda igual', '+{added} −{removed} linhas; o resto do arquivo (e seus comentários) fica igual', '+{added} −{removed} lignes ; le reste du fichier (et ses commentaires) ne change pas', '+{added} −{removed} righe; il resto del file (e i suoi commenti) resta uguale', '+{added} −{removed} Zeilen; der Rest der Datei (und ihre Kommentare) bleibt gleich', '+{added} −{removed} regels; de rest van het bestand (en de opmerkingen) blijft gelijk', '+{added} −{removed} línies; la resta del fitxer (i els comentaris) queda igual', '+{added} −{removed} liñas; o resto do ficheiro (e os seus comentarios) queda igual', '+{added} −{removed} lerro; fitxategiaren gainerakoa (eta iruzkinak) berdin geratzen da'],
	['dataFile', 'Data (JSON) to read the entities from', 'Datos (JSON) de los que leer las entidades', 'Dados (JSON) dos quais ler as entidades', 'Données (JSON) dont lire les entités', 'Dati (JSON) da cui leggere le entità', 'Daten (JSON), aus denen die Entitäten gelesen werden', 'Gegevens (JSON) om de entiteiten uit te lezen', 'Dades (JSON) de les quals llegir les entitats', 'Datos (JSON) dos que ler as entidades', 'Entitateak irakurtzeko datuak (JSON)'],
	['entityOfData', 'Entity of the data', 'Entidad de los datos', 'Entidade dos dados', 'Entité des données', 'Entità dei dati', 'Entität der Daten', 'Entiteit van de gegevens', 'Entitat de les dades', 'Entidade dos datos', 'Datuen entitatea'],
	['incorporateNote', 'Then the schema reloads, push creates its tables and the rows are imported', 'Después el esquema se recarga, push crea sus tablas y se importan las filas', 'Depois o esquema recarrega, push cria as tabelas e as linhas são importadas', 'Ensuite le schéma se recharge, push crée ses tables et les lignes sont importées', 'Poi lo schema si ricarica, push crea le tabelle e le righe vengono importate', 'Dann wird das Schema neu geladen, push legt die Tabellen an und die Zeilen werden importiert', 'Daarna laadt het schema opnieuw, push maakt de tabellen en de rijen worden geïmporteerd', 'Després l’esquema es recarrega, push crea les taules i s’importen les files', 'Despois o esquema recárgase, push crea as táboas e impórtanse as filas', 'Ondoren eskema berriz kargatzen da, push-ek taulak sortzen ditu eta errenkadak inportatzen dira'],
	['commands', 'Commands', 'Comandos', 'Comandos', 'Commandes', 'Comandi', 'Befehle', 'Opdrachten', 'Ordres', 'Comandos', 'Aginduak'],
	['stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage', 'Stage'],
	['preview', 'See what it will do', 'Ver qué va a hacer', 'Ver o que vai fazer', 'Voir ce qu’elle fera', 'Vedi cosa farà', 'Ansehen, was er tut', 'Bekijk wat het doet', 'Mira què farà', 'Ver que vai facer', 'Ikusi zer egingo duen'],
	['runNamed', 'Run {name}', 'Ejecutar {name}', 'Executar {name}', 'Exécuter {name}', 'Esegui {name}', '{name} ausführen', '{name} uitvoeren', 'Executa {name}', 'Executar {name}', 'Exekutatu {name}'],
	['force', 'go on after a sentence fails (tryAllCan)', 'seguir aunque falle una sentencia (tryAllCan)', 'continuar se uma sentença falhar (tryAllCan)', 'continuer si une instruction échoue (tryAllCan)', 'continua se una istruzione fallisce (tryAllCan)', 'weitermachen, wenn ein Befehl fehlschlägt (tryAllCan)', 'doorgaan als een opdracht faalt (tryAllCan)', 'continua encara que falli una sentència (tryAllCan)', 'seguir aínda que falle unha sentenza (tryAllCan)', 'jarraitu esaldi batek huts egiten badu (tryAllCan)'],
	['typeStage', 'Type {name} to confirm:', 'Escribí {name} para confirmar:', 'Digite {name} para confirmar:', 'Tapez {name} pour confirmer :', 'Scrivi {name} per confermare:', 'Gib {name} zur Bestätigung ein:', 'Typ {name} om te bevestigen:', 'Escriu {name} per confirmar:', 'Escribe {name} para confirmar:', 'Idatzi {name} berresteko:'],
	['willRun', 'What {name} will run on stage {stage}', 'Lo que {name} va a ejecutar en el stage {stage}', 'O que {name} vai executar no stage {stage}', 'Ce que {name} exécutera sur le stage {stage}', 'Cosa eseguirà {name} sullo stage {stage}', 'Was {name} im Stage {stage} ausführt', 'Wat {name} op stage {stage} uitvoert', 'El que {name} executarà al stage {stage}', 'O que {name} vai executar no stage {stage}', '{name}-ek {stage} stagean exekutatuko duena'],
	['nothingToRun', 'Nothing to run: the databases are in step with the model', 'Nada que ejecutar: las bases coinciden con el modelo', 'Nada a executar: os bancos estão de acordo com o modelo', 'Rien à exécuter : les bases correspondent au modèle', 'Niente da eseguire: i database corrispondono al modello', 'Nichts auszuführen: die Datenbanken entsprechen dem Modell', 'Niets uit te voeren: de databases komen overeen met het model', 'Res a executar: les bases coincideixen amb el model', 'Nada que executar: as bases coinciden co modelo', 'Ez dago exekutatzekorik: datu-baseak ereduarekin bat datoz'],
	['rowsToWrite', 'The rows it will write', 'Las filas que va a escribir', 'As linhas que vai gravar', 'Les lignes qu’elle écrira', 'Le righe che scriverà', 'Die Zeilen, die er schreibt', 'De rijen die het schrijft', 'Les files que escriurà', 'As filas que vai escribir', 'Idatziko dituen errenkadak'],
	['chooseExport', 'An export of a stage (JSON)', 'Un export de un stage (JSON)', 'Um export de um stage (JSON)', 'Un export d’un stage (JSON)', 'Un export di uno stage (JSON)', 'Ein Export eines Stage (JSON)', 'Een export van een stage (JSON)', 'Un export d’un stage (JSON)', 'Un export dun stage (JSON)', 'Stage baten esportazio bat (JSON)'],
	['saveToData', 'also save it in data/ of the workspace', 'guardarlo también en data/ del workspace', 'salvar também em data/ do workspace', 'l’enregistrer aussi dans data/ de l’espace de travail', 'salvalo anche in data/ del workspace', 'auch in data/ des Workspace speichern', 'ook opslaan in data/ van de workspace', 'desa’l també a data/ del workspace', 'gardalo tamén en data/ do workspace', 'gorde ere workspace-aren data/-n'],
	['download', 'Download', 'Descargar', 'Baixar', 'Télécharger', 'Scarica', 'Herunterladen', 'Downloaden', 'Baixa', 'Descargar', 'Deskargatu'],
	['jobs', 'Last commands', 'Últimos comandos', 'Últimos comandos', 'Dernières commandes', 'Ultimi comandi', 'Letzte Befehle', 'Laatste opdrachten', 'Darreres ordres', 'Últimos comandos', 'Azken aginduak'],
	['noJobs', 'No command run yet', 'Todavía no se ejecutó ningún comando', 'Nenhum comando executado ainda', 'Aucune commande exécutée', 'Nessun comando eseguito', 'Noch kein Befehl ausgeführt', 'Nog geen opdracht uitgevoerd', 'Encara no s’ha executat cap ordre', 'Aínda non se executou ningún comando', 'Oraindik ez da agindurik exekutatu'],
	['running', 'running', 'en curso', 'em andamento', 'en cours', 'in corso', 'läuft', 'bezig', 'en curs', 'en curso', 'martxan'],
	['done', 'done', 'terminado', 'concluído', 'terminé', 'completato', 'fertig', 'klaar', 'acabat', 'rematado', 'eginda'],
	['failed', 'failed', 'falló', 'falhou', 'échoué', 'fallito', 'fehlgeschlagen', 'mislukt', 'ha fallat', 'fallou', 'huts egin du'],
	['savedIn', 'Saved in {name}', 'Guardado en {name}', 'Salvo em {name}', 'Enregistré dans {name}', 'Salvato in {name}', 'Gespeichert in {name}', 'Opgeslagen in {name}', 'Desat a {name}', 'Gardado en {name}', '{name}-n gordeta'],
	['inStep', 'No differences: the databases are in step with the model', 'Sin diferencias: las bases coinciden con el modelo', 'Sem diferenças: os bancos estão de acordo com o modelo', 'Aucune différence : les bases correspondent au modèle', 'Nessuna differenza: i database corrispondono al modello', 'Keine Unterschiede: die Datenbanken entsprechen dem Modell', 'Geen verschillen: de databases komen overeen met het model', 'Sense diferències: les bases coincideixen amb el model', 'Sen diferenzas: as bases coinciden co modelo', 'Ez dago desberdintasunik: datu-baseak ereduarekin bat datoz'],
	['browserItems', '{n} items are saved in this browser only.', '{n} elementos están guardados solo en este navegador.', '{n} itens estão salvos só neste navegador.', '{n} éléments sont enregistrés seulement dans ce navigateur.', '{n} elementi sono salvati solo in questo browser.', '{n} Elemente sind nur in diesem Browser gespeichert.', '{n} items zijn alleen in deze browser opgeslagen.', '{n} elements estan desats només en aquest navegador.', '{n} elementos están gardados só neste navegador.', '{n} elementu nabigatzaile honetan bakarrik daude gordeta.'],
	['copyToWorkspace', 'Copy them to the workspace', 'Copiarlos al workspace', 'Copiá-los para o workspace', 'Les copier dans l’espace de travail', 'Copiali nel workspace', 'In den Workspace kopieren', 'Naar de workspace kopiëren', 'Copia’ls al workspace', 'Copialos ao workspace', 'Kopiatu workspace-ra'],
	['unreadableFiles', 'Files of workbench/ that can’t be read (fix them by hand):', 'Archivos de workbench/ que no se pueden leer (corregilos a mano):', 'Arquivos de workbench/ que não podem ser lidos (corrija à mão):', 'Fichiers de workbench/ illisibles (corrigez-les à la main) :', 'File di workbench/ che non si possono leggere (correggili a mano):', 'Dateien in workbench/, die nicht gelesen werden können (von Hand korrigieren):', 'Bestanden in workbench/ die niet gelezen kunnen worden (handmatig herstellen):', 'Fitxers de workbench/ que no es poden llegir (corregeix-los a mà):', 'Ficheiros de workbench/ que non se poden ler (corríxeos a man):', 'Irakur ezin diren workbench/-eko fitxategiak (zuzendu eskuz):'],
	['copiedToWorkspace', '{n} items copied to the workspace', '{n} elementos copiados al workspace', '{n} itens copiados para o workspace', '{n} éléments copiés dans l’espace de travail', '{n} elementi copiati nel workspace', '{n} Elemente in den Workspace kopiert', '{n} items naar de workspace gekopieerd', '{n} elements copiats al workspace', '{n} elementos copiados ao workspace', '{n} elementu workspace-ra kopiatuta']
)

const ORDER: Locale[] = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'ca', 'gl', 'eu']

const BY_LOCALE = Object.fromEntries(ORDER.map((locale, i) => [locale, Object.fromEntries(ROWS.map(row => [row[0], row[i + 1]])) as unknown as AdminMessages])) as Record<Locale, AdminMessages>

export const adminMessagesOf = (locale: string | undefined): AdminMessages =>
	BY_LOCALE[locale as Locale] ?? BY_LOCALE[(locale ?? '').slice(0, 2) as Locale] ?? BY_LOCALE.en

export { format }
