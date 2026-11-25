import { format, Locale } from './i18n'

/** The texts of the administration of the workspaces (the schema in YAML, new and removed schemas); {name} is replaced */
export interface AdminMessages {
	history: string
	historyEmpty: string
	historyUnavailable: string
	historyMore: string
	historyWhen: string
	historyWho: string
	historyWhat: string
	historyBefore: string
	historyAfter: string
	historyChanges: string
	changedBy: string
	remoteChange: string
	refreshNow: string
	viewTraces: string
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
	variables: string
	defined: string
	varName: string
	varState: string
	varUsedIn: string
	varValue: string
	notDefined: string
	newValue: string
	setValue: string
	variablesNote: string
	cmd_fetch: string
	cmd_export: string
	cmd_exportSave: string
	cmd_import: string
	cmd_push: string
	cmd_pull: string
	cmd_drop: string
	cmd_introspect: string
	cmd_incorporate: string
	cmd_build: string
	cmd_version: string
	about: string
	schemaName: string
	schemaDescription: string
	schemaVersion: string
	closeTab: string
	closeOthers: string
	closeAll: string
	current: string
	contextVariables: string
	insertIt: string
	expressionKeys: string
	apply: string
	editCondition: string
	conditionOf: string
	theRest: string
	metadata: string
	openSchema: string
	rootTaken: string
	stageSourcesNote: string
	condition: string
	conditionHint: string
	expression: string
	expressionsOf: string
	validationsHint: string
	helpReadExp: string
	helpWriteExp: string
	helpReadValue: string
	helpWriteValue: string
	addSource: string
	moveUp: string
	moveDown: string
	notAVariable: string
	build: string
	buildWrite: string
	buildZip: string
	written: string
	edit: string
	schemas: string
	config: string
	domain: string
	application: string
	infrastructure: string
	data: string
	src: string
	model: string
	projects: string
	newProject: string
	empty: string
	commandsOf: string
	stageDiagram: string
	stageDiagramOf: string
	stageGateway: string
	stageTables: string
	stageUnrouted: string
	stageConditionError: string
	stageChoose: string
	stageReads: string
	stageWrites: string
	stageNoRouting: string
	stageReadsHere: string
	stageWritesHere: string
	stageLivesIn: string
	stageShow: string
	stageShowTables: string
	stageShowNames: string
	stageGatewayTop: string
	stageGatewayLeft: string
	state: string
	sourceCode: string
	downloadZip: string
	rebuildCode: string
	removeCode: string
	removeCodeConfirm: string
	rebuilt: string
	removedCode: string
	buildParts: string
	buildModel: string
	buildRepositories: string
}

type Row = [keyof AdminMessages, ...string[]]

const ROWS: Row[] = [
	['history', 'History', 'Historial', 'Histórico', 'Historique', 'Cronologia', 'Verlauf', 'Geschiedenis', 'Historial', 'Historial', 'Historia'],
	['historyEmpty', 'No changes recorded yet', 'Todavía no hay cambios registrados', 'Ainda não há alterações registradas', 'Aucune modification enregistrée pour l’instant', 'Nessuna modifica registrata finora', 'Noch keine Änderungen aufgezeichnet', 'Nog geen wijzigingen vastgelegd', 'Encara no hi ha canvis registrats', 'Aínda non hai cambios rexistrados', 'Oraindik ez dago aldaketarik erregistratuta'],
	['historyUnavailable', 'This gateway does not keep the history of the schema', 'Esta gateway no guarda el historial del esquema', 'Esta gateway não guarda o histórico do esquema', 'Cette passerelle ne conserve pas l’historique du schéma', 'Questo gateway non conserva la cronologia dello schema', 'Dieses Gateway speichert den Verlauf des Schemas nicht', 'Deze gateway bewaart de geschiedenis van het schema niet', 'Aquesta passarel·la no desa l’historial de l’esquema', 'Esta pasarela non garda o historial do esquema', 'Pasabide honek ez du eskemaren historia gordetzen'],
	['historyMore', 'Older changes', 'Cambios anteriores', 'Alterações anteriores', 'Modifications plus anciennes', 'Modifiche precedenti', 'Ältere Änderungen', 'Oudere wijzigingen', 'Canvis anteriors', 'Cambios anteriores', 'Aldaketa zaharragoak'],
	['historyWhen', 'When', 'Cuándo', 'Quando', 'Quand', 'Quando', 'Wann', 'Wanneer', 'Quan', 'Cando', 'Noiz'],
	['historyWho', 'Who', 'Quién', 'Quem', 'Qui', 'Chi', 'Wer', 'Wie', 'Qui', 'Quen', 'Nork'],
	['historyWhat', 'What', 'Qué', 'O quê', 'Quoi', 'Cosa', 'Was', 'Wat', 'Què', 'Que', 'Zer'],
	['historyBefore', 'Before', 'Antes', 'Antes', 'Avant', 'Prima', 'Vorher', 'Voor', 'Abans', 'Antes', 'Lehen'],
	['historyAfter', 'After', 'Después', 'Depois', 'Après', 'Dopo', 'Nachher', 'Na', 'Després', 'Despois', 'Ondoren'],
	['historyChanges', 'Changes', 'Cambios', 'Alterações', 'Modifications', 'Modifiche', 'Änderungen', 'Wijzigingen', 'Canvis', 'Cambios', 'Aldaketak'],
	['changedBy', '{name} changed it at {time}: this is what it has now', '{name} lo cambió a las {time}: esto es lo que tiene ahora', '{name} alterou às {time}: isto é o que tem agora', '{name} l’a modifié à {time} : voici ce qu’il contient', '{name} l’ha cambiato alle {time}: ecco cosa contiene ora', '{name} hat es um {time} geändert: das ist der aktuelle Stand', '{name} heeft het om {time} gewijzigd: dit is wat het nu bevat', '{name} l’ha canviat a les {time}: això és el que té ara', '{name} cambiouno ás {time}: isto é o que ten agora', '{name}(e)k aldatu du {time}(e)tan: hau da orain duena'],
	['remoteChange', '{name} changed {target} in {schema}', '{name} cambió {target} en {schema}', '{name} alterou {target} em {schema}', '{name} a modifié {target} dans {schema}', '{name} ha cambiato {target} in {schema}', '{name} hat {target} in {schema} geändert', '{name} heeft {target} in {schema} gewijzigd', '{name} ha canviat {target} a {schema}', '{name} cambiou {target} en {schema}', '{name}(e)k {target} aldatu du {schema} eskeman'],
	['refreshNow', 'Refresh', 'Actualizar', 'Atualizar', 'Actualiser', 'Aggiorna', 'Aktualisieren', 'Vernieuwen', 'Actualitza', 'Actualizar', 'Freskatu'],
	['viewTraces', 'View traces', 'Ver trazas', 'Ver rastreamentos', 'Voir les traces', 'Vedi le tracce', 'Traces anzeigen', 'Traces bekijken', 'Veure traces', 'Ver trazas', 'Ikusi arrastoak'],
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
	['edit', 'Edit', 'Editar', 'Editar', 'Modifier', 'Modifica', 'Bearbeiten', 'Bewerken', 'Edita', 'Editar', 'Editatu'],
	['schemas', 'Schemas', 'Esquemas', 'Esquemas', 'Schémas', 'Schemi', 'Schemas', 'Schema’s', 'Esquemes', 'Esquemas', 'Eskemak'],
	['config', 'config', 'config', 'config', 'config', 'config', 'config', 'config', 'config', 'config', 'config'],
	['domain', 'domain', 'domain', 'domain', 'domain', 'domain', 'domain', 'domain', 'domain', 'domain', 'domain'],
	['application', 'application', 'application', 'application', 'application', 'application', 'application', 'application', 'application', 'application', 'application'],
	['infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure', 'infrastructure'],
	['data', 'data', 'data', 'data', 'data', 'data', 'data', 'data', 'data', 'data', 'data'],
	['src', 'src', 'src', 'src', 'src', 'src', 'src', 'src', 'src', 'src', 'src'],
	['model', 'model', 'model', 'model', 'model', 'model', 'model', 'model', 'model', 'model', 'model'],
	['projects', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench', 'Workbench'],
	['newProject', 'New project', 'Nuevo proyecto', 'Novo projeto', 'Nouveau projet', 'Nuovo progetto', 'Neues Projekt', 'Nieuw project', 'Projecte nou', 'Novo proxecto', 'Proiektu berria'],
	['empty', '(empty)', '(vacío)', '(vazio)', '(vide)', '(vuoto)', '(leer)', '(leeg)', '(buit)', '(baleiro)', '(hutsa)'],
	['commandsOf', 'Schema {name}', 'Esquema {name}', 'Esquema {name}', 'Schéma {name}', 'Schema {name}', 'Schema {name}', 'Schema {name}', 'Esquema {name}', 'Esquema {name}', '{name} eskema'],
	['variables', 'Variables (.env)', 'Variables (.env)', 'Variáveis (.env)', 'Variables (.env)', 'Variabili (.env)', 'Variablen (.env)', 'Variabelen (.env)', 'Variables (.env)', 'Variables (.env)', 'Aldagaiak (.env)'],
	['defined', 'defined', 'definida', 'definida', 'définie', 'definita', 'definiert', 'gedefinieerd', 'definida', 'definida', 'definituta'],
	['varName', 'variable', 'variable', 'variável', 'variable', 'variabile', 'Variable', 'variabele', 'variable', 'variable', 'aldagaia'],
	['varState', 'state', 'estado', 'estado', 'état', 'stato', 'Zustand', 'status', 'estat', 'estado', 'egoera'],
	['varUsedIn', 'used in', 'se usa en', 'usada em', 'utilisée dans', 'usata in', 'verwendet in', 'gebruikt in', 's’usa a', 'úsase en', 'non erabilia'],
	['varValue', 'value', 'valor', 'valor', 'valeur', 'valore', 'Wert', 'waarde', 'valor', 'valor', 'balioa'],
	['notDefined', 'not in .env', 'no está en .env', 'não está no .env', 'absente de .env', 'non in .env', 'nicht in .env', 'niet in .env', 'no és a .env', 'non está en .env', 'ez dago .env-n'],
	['newValue', 'New value (not shown again)', 'Valor nuevo (no se vuelve a mostrar)', 'Valor novo (não é mostrado de novo)', 'Nouvelle valeur (plus affichée ensuite)', 'Nuovo valore (non verrà più mostrato)', 'Neuer Wert (wird nicht wieder angezeigt)', 'Nieuwe waarde (wordt niet meer getoond)', 'Valor nou (no es torna a mostrar)', 'Valor novo (non se volve mostrar)', 'Balio berria (ez da berriz erakutsiko)'],
	['setValue', 'Set', 'Definir', 'Definir', 'Définir', 'Imposta', 'Setzen', 'Instellen', 'Defineix', 'Definir', 'Ezarri'],
	['variablesNote', 'The values live in the .env of the workspace and are never shown; a variable may also come from the gateway’s configuration or environment. Changing them reloads the schema.', 'Los valores viven en el .env del workspace y nunca se muestran; una variable también puede venir de la configuración o del entorno de la gateway. Cambiarlas recarga el esquema.', 'Os valores ficam no .env do workspace e nunca são mostrados; uma variável também pode vir da configuração ou do ambiente da gateway. Alterá-las recarrega o esquema.', 'Les valeurs vivent dans le .env de l’espace de travail et ne sont jamais affichées ; une variable peut aussi venir de la configuration ou de l’environnement de la passerelle. Les changer recharge le schéma.', 'I valori stanno nel .env del workspace e non vengono mai mostrati; una variabile può venire anche dalla configurazione o dall’ambiente del gateway. Cambiarle ricarica lo schema.', 'Die Werte stehen in der .env des Workspace und werden nie angezeigt; eine Variable kann auch aus der Konfiguration oder Umgebung des Gateways kommen. Eine Änderung lädt das Schema neu.', 'De waarden staan in de .env van de workspace en worden nooit getoond; een variabele kan ook uit de configuratie of omgeving van de gateway komen. Wijzigen laadt het schema opnieuw.', 'Els valors viuen al .env del workspace i no es mostren mai; una variable també pot venir de la configuració o de l’entorn de la passarel·la. Canviar-les recarrega l’esquema.', 'Os valores viven no .env do workspace e nunca se amosan; unha variable tamén pode vir da configuración ou do contorno da pasarela. Cambialas recarga o esquema.', 'Balioak workspace-aren .env-n daude eta ez dira inoiz erakusten; aldagai bat pasabidearen konfiguraziotik edo ingurunetik ere etor daiteke. Aldatzeak eskema berriz kargatzen du.'],
	['build', 'Code (build)', 'Código (build)', 'Código (build)', 'Code (build)', 'Codice (build)', 'Code (build)', 'Code (build)', 'Codi (build)', 'Código (build)', 'Kodea (build)'],
	['buildWrite', 'Write in src/ of the workspace', 'Escribir en src/ del workspace', 'Gravar em src/ do workspace', 'Écrire dans src/ de l’espace de travail', 'Scrivi in src/ del workspace', 'In src/ des Workspace schreiben', 'Schrijven in src/ van de workspace', 'Escriu a src/ del workspace', 'Escribir en src/ do workspace', 'Idatzi workspace-aren src/-n'],
	['buildZip', 'Download .zip', 'Descargar .zip', 'Baixar .zip', 'Télécharger le .zip', 'Scarica .zip', '.zip herunterladen', '.zip downloaden', 'Baixa el .zip', 'Descargar .zip', 'Deskargatu .zip'],
	['written', 'created and updated: {n} (a repository already there is the user’s and stays)', 'creados y actualizados: {n} (un repositorio que ya estaba es del usuario y queda)', 'criados e atualizados: {n} (um repositório que já existia é do usuário e fica)', 'créés et mis à jour : {n} (un dépôt déjà présent appartient à l’utilisateur et reste)', 'creati e aggiornati: {n} (un repository già presente è dell’utente e resta)', 'erstellt und aktualisiert: {n} (ein vorhandenes Repository gehört dem Nutzer und bleibt)', 'aangemaakt en bijgewerkt: {n} (een bestaande repository is van de gebruiker en blijft)', 'creats i actualitzats: {n} (un repositori que ja hi era és de l’usuari i es queda)', 'creados e actualizados: {n} (un repositorio que xa estaba é do usuario e queda)', 'sortuak eta eguneratuak: {n} (lehendik zegoen biltegi bat erabiltzailearena da eta geratzen da)'],
	['forms', 'Schema (forms)', 'Esquema (formularios)', 'Esquema (formulários)', 'Schéma (formulaires)', 'Schema (moduli)', 'Schema (Formulare)', 'Schema (formulieren)', 'Esquema (formularis)', 'Esquema (formularios)', 'Eskema (inprimakiak)'],
	['entities', 'Entities', 'Entidades', 'Entidades', 'Entités', 'Entità', 'Entitäten', 'Entiteiten', 'Entitats', 'Entidades', 'Entitateak'],
	['enums', 'Enums', 'Enums', 'Enums', 'Énumérations', 'Enum', 'Enums', 'Enums', 'Enums', 'Enums', 'Enumak'],
	['sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources', 'Sources'],
	['mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings', 'Mappings'],
	['stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages', 'Stages'],
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
	['copiedToWorkspace', '{n} items copied to the workspace', '{n} elementos copiados al workspace', '{n} itens copiados para o workspace', '{n} éléments copiés dans l’espace de travail', '{n} elementi copiati nel workspace', '{n} Elemente in den Workspace kopiert', '{n} items naar de workspace gekopieerd', '{n} elements copiats al workspace', '{n} elementos copiados ao workspace', '{n} elementu workspace-ra kopiatuta'],
	['cmd_fetch', 'compare the model with the databases', 'comparar el modelo con las bases', 'comparar o modelo com os bancos', 'comparer le modèle avec les bases', 'confrontare il modello con i database', 'das Modell mit den Datenbanken vergleichen', 'het model met de databases vergelijken', 'comparar el model amb les bases', 'comparar o modelo coas bases', 'eredua datu-baseekin alderatu'],
	['cmd_export', 'export the data of the stage (download)', 'exportar los datos del stage (descarga)', 'exportar os dados do stage (download)', 'exporter les données du stage (téléchargement)', 'esportare i dati dello stage (download)', 'die Daten des Stage exportieren (Download)', 'de gegevens van de stage exporteren (download)', 'exportar les dades del stage (descàrrega)', 'exportar os datos do stage (descarga)', 'stage-aren datuak esportatu (deskarga)'],
	['cmd_exportSave', 'export the data of the stage to data/', 'exportar los datos del stage a data/', 'exportar os dados do stage para data/', 'exporter les données du stage dans data/', 'esportare i dati dello stage in data/', 'die Daten des Stage nach data/ exportieren', 'de gegevens van de stage naar data/ exporteren', 'exportar les dades del stage a data/', 'exportar os datos do stage a data/', 'stage-aren datuak data/-ra esportatu'],
	['cmd_import', 'import an export file into the stage', 'importar un archivo exportado al stage', 'importar um arquivo exportado no stage', 'importer un fichier d’export dans le stage', 'importare un file esportato nello stage', 'eine Exportdatei in den Stage importieren', 'een exportbestand in de stage importeren', 'importar un fitxer exportat al stage', 'importar un ficheiro exportado ao stage', 'esportazio-fitxategi bat stage-ra inportatu'],
	['cmd_push', 'apply the model to the databases', 'aplicar el modelo a las bases', 'aplicar o modelo aos bancos', 'appliquer le modèle aux bases', 'applicare il modello ai database', 'das Modell auf die Datenbanken anwenden', 'het model op de databases toepassen', 'aplicar el model a les bases', 'aplicar o modelo ás bases', 'eredua datu-baseei aplikatu'],
	['cmd_pull', 'bring the databases into the model', 'traer las bases al modelo', 'trazer os bancos para o modelo', 'ramener les bases dans le modèle', 'portare i database nel modello', 'die Datenbanken ins Modell übernehmen', 'de databases in het model overnemen', 'portar les bases al model', 'traer as bases ao modelo', 'datu-baseak eredura ekarri'],
	['cmd_drop', 'remove the tables of the stage', 'eliminar las tablas del stage', 'remover as tabelas do stage', 'supprimer les tables du stage', 'eliminare le tabelle dello stage', 'die Tabellen des Stage löschen', 'de tabellen van de stage verwijderen', 'eliminar les taules del stage', 'eliminar as táboas do stage', 'stage-aren taulak ezabatu'],
	['cmd_introspect', 'create an entity from a data file', 'crear una entidad desde un archivo de datos', 'criar uma entidade a partir de um arquivo de dados', 'créer une entité depuis un fichier de données', 'creare un’entità da un file di dati', 'eine Entität aus einer Datendatei erstellen', 'een entiteit uit een gegevensbestand maken', 'crear una entitat des d’un fitxer de dades', 'crear unha entidade desde un ficheiro de datos', 'datu-fitxategi batetik entitate bat sortu'],
	['cmd_incorporate', 'create an entity from a data file and import its rows', 'crear una entidad desde un archivo de datos e importar sus filas', 'criar uma entidade a partir de um arquivo de dados e importar as linhas', 'créer une entité depuis un fichier de données et importer ses lignes', 'creare un’entità da un file di dati e importarne le righe', 'eine Entität aus einer Datendatei erstellen und ihre Zeilen importieren', 'een entiteit uit een gegevensbestand maken en de rijen importeren', 'crear una entitat des d’un fitxer de dades i importar-ne les files', 'crear unha entidade desde un ficheiro de datos e importar as filas', 'datu-fitxategi batetik entitate bat sortu eta errenkadak inportatu'],
	['cmd_build', 'generate the model code (src/ or zip)', 'generar el código del modelo (src/ o zip)', 'gerar o código do modelo (src/ ou zip)', 'générer le code du modèle (src/ ou zip)', 'generare il codice del modello (src/ o zip)', 'den Code des Modells erzeugen (src/ oder Zip)', 'de code van het model genereren (src/ of zip)', 'generar el codi del model (src/ o zip)', 'xerar o código do modelo (src/ ou zip)', 'ereduaren kodea sortu (src/ edo zip)'],
	['cmd_version', 'the versions of λORM in the gateway', 'las versiones de λORM en la gateway', 'as versões do λORM na gateway', 'les versions de λORM dans la gateway', 'le versioni di λORM nel gateway', 'die λORM-Versionen im Gateway', 'de λORM-versies in de gateway', 'les versions de λORM a la gateway', 'as versións de λORM na gateway', 'gateway-ko λORM bertsioak'],
	['about', 'About', 'Acerca de', 'Sobre', 'À propos', 'Informazioni', 'Über', 'Over', 'Quant a', 'Acerca de', 'Honi buruz'],
	['schemaName', 'Name', 'Nombre', 'Nome', 'Nom', 'Nome', 'Name', 'Naam', 'Nom', 'Nome', 'Izena'],
	['schemaDescription', 'Description', 'Descripción', 'Descrição', 'Description', 'Descrizione', 'Beschreibung', 'Beschrijving', 'Descripció', 'Descrición', 'Deskribapena'],
	['schemaVersion', 'Version', 'Versión', 'Versão', 'Version', 'Versione', 'Version', 'Versie', 'Versió', 'Versión', 'Bertsioa'],
	['closeTab', 'Close', 'Cerrar', 'Fechar', 'Fermer', 'Chiudi', 'Schließen', 'Sluiten', 'Tanca', 'Pechar', 'Itxi'],
	['closeOthers', 'Close others', 'Cerrar los demás', 'Fechar os outros', 'Fermer les autres', 'Chiudi gli altri', 'Andere schließen', 'Andere sluiten', 'Tanca els altres', 'Pechar os demais', 'Besteak itxi'],
	['closeAll', 'Close all', 'Cerrar todos', 'Fechar todos', 'Tout fermer', 'Chiudi tutti', 'Alle schließen', 'Alles sluiten', 'Tanca-ho tot', 'Pechar todos', 'Denak itxi'],
	['stageSourcesNote', 'In order: the first source whose condition is true takes the sentence; a last one without condition takes the rest.', 'En orden: el primer source cuya condición es verdadera toma la sentencia; uno último sin condición toma el resto.', 'Em ordem: o primeiro source cuja condição é verdadeira fica com a sentença; um último sem condição fica com o resto.', 'Dans l’ordre : la première source dont la condition est vraie prend la phrase ; une dernière sans condition prend le reste.', 'In ordine: la prima source la cui condizione è vera prende la frase; un’ultima senza condizione prende il resto.', 'Der Reihe nach: die erste Source, deren Bedingung wahr ist, nimmt den Satz; eine letzte ohne Bedingung nimmt den Rest.', 'Op volgorde: de eerste source waarvan de voorwaarde waar is neemt de zin; een laatste zonder voorwaarde neemt de rest.', 'En ordre: el primer source amb la condició certa pren la sentència; un últim sense condició pren la resta.', 'En orde: o primeiro source coa condición certa toma a sentenza; un último sen condición toma o resto.', 'Ordenean: baldintza egiazkoa duen lehen source-ak hartzen du sententzia; baldintzarik gabeko azken batek gainerakoa.'],
	['stageDiagram', 'Diagram of the stage', 'Diagrama del stage', 'Diagrama do stage', 'Diagramme du stage', 'Diagramma dello stage', 'Diagramm des Stage', 'Diagram van de stage', 'Diagrama de l’stage', 'Diagrama do stage', 'Stage-aren diagrama'],
	['stageDiagramOf', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', 'Stage {name}', '{name} stage-a'],
	['stageGateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway', 'Data Gateway'],
	['stageTables', '{n} tables', '{n} tablas', '{n} tabelas', '{n} tables', '{n} tabelle', '{n} Tabellen', '{n} tabellen', '{n} taules', '{n} táboas', '{n} taula'],
	['stageUnrouted', 'No source of the stage takes: {names}', 'Ningún source del stage toma: {names}', 'Nenhum source do stage fica com: {names}', 'Aucune source du stage ne prend : {names}', 'Nessuna source dello stage prende: {names}', 'Keine Source des Stage nimmt: {names}', 'Geen source van de stage neemt: {names}', 'Cap source de l’stage pren: {names}', 'Ningún source do stage toma: {names}', 'Stage-aren source batek ere ez du hartzen: {names}'],
	['stageConditionError', 'The condition does not evaluate (it is taken as false): {error}', 'La condición no se puede evaluar (se toma como falsa): {error}', 'A condição não pode ser avaliada (é tomada como falsa): {error}', 'La condition ne s’évalue pas (elle est prise comme fausse) : {error}', 'La condizione non si valuta (è presa come falsa): {error}', 'Die Bedingung lässt sich nicht auswerten (sie gilt als falsch): {error}', 'De voorwaarde valt niet te evalueren (ze geldt als onwaar): {error}', 'La condició no s’avalua (es pren com a falsa): {error}', 'A condición non se avalía (tómase como falsa): {error}', 'Baldintza ezin da ebaluatu (faltsutzat hartzen da): {error}'],
	['stageChoose', 'Click the arrow of a source to see its condition.', 'Hacé clic en la flecha de un source para ver su condición.', 'Clique na seta de um source para ver a sua condição.', 'Cliquez sur la flèche d’une source pour voir sa condition.', 'Fai clic sulla freccia di una source per vederne la condizione.', 'Klicke auf den Pfeil einer Source, um ihre Bedingung zu sehen.', 'Klik op de pijl van een source om de voorwaarde te zien.', 'Fes clic a la fletxa d’un source per veure’n la condició.', 'Fai clic na frecha dun source para ver a súa condición.', 'Egin klik source baten geziaren gainean bere baldintza ikusteko.'],
	['stageReads', 'reads: {source}', 'lecturas: {source}', 'leituras: {source}', 'lectures : {source}', 'letture: {source}', 'Lesen: {source}', 'lezen: {source}', 'lectures: {source}', 'lecturas: {source}', 'irakurketak: {source}'],
	['stageWrites', 'writes: {source}', 'escrituras: {source}', 'escritas: {source}', 'écritures : {source}', 'scritture: {source}', 'Schreiben: {source}', 'schrijven: {source}', 'escriptures: {source}', 'escrituras: {source}', 'idazketak: {source}'],
	['stageNoRouting', 'This gateway can’t tell where the entities of a stage go (data-gateway 4.1.0 or later).', 'Este gateway no puede decir a dónde va cada entidad de un stage (data-gateway 4.1.0 o posterior).', 'Este gateway não pode dizer para onde vai cada entidade de um stage (data-gateway 4.1.0 ou posterior).', 'Ce gateway ne peut pas dire où vont les entités d’un stage (data-gateway 4.1.0 ou plus récent).', 'Questo gateway non può dire dove vanno le entità di uno stage (data-gateway 4.1.0 o successivo).', 'Dieses Gateway kann nicht sagen, wohin die Entitäten eines Stage gehen (data-gateway 4.1.0 oder neuer).', 'Deze gateway kan niet zeggen waar de entiteiten van een stage heen gaan (data-gateway 4.1.0 of later).', 'Aquest gateway no pot dir on va cada entitat d’un stage (data-gateway 4.1.0 o posterior).', 'Este gateway non pode dicir a onde vai cada entidade dun stage (data-gateway 4.1.0 ou posterior).', 'Gateway honek ezin du esan stage baten entitateak nora doazen (data-gateway 4.1.0 edo berriagoa).'],
	['stageReadsHere', 'its reads', 'sus lecturas', 'as suas leituras', 'ses lectures', 'le sue letture', 'ihr Lesen', 'het lezen', 'les seves lectures', 'as súas lecturas', 'bere irakurketak'],
	['stageWritesHere', 'its writes', 'sus escrituras', 'as suas escritas', 'ses écritures', 'le sue scritture', 'ihr Schreiben', 'het schrijven', 'les seves escriptures', 'as súas escrituras', 'bere idazketak'],
	['stageLivesIn', 'lives in {source}', 'vive en {source}', 'vive em {source}', 'vit dans {source}', 'vive in {source}', 'liegt in {source}', 'woont in {source}', 'viu a {source}', 'vive en {source}', '{source}-n bizi da'],
	['stageShow', 'show', 'mostrar', 'mostrar', 'afficher', 'mostra', 'zeigen', 'tonen', 'mostra', 'amosar', 'erakutsi'],
	['stageShowTables', 'the tables of each source', 'las tablas de cada source', 'as tabelas de cada source', 'les tables de chaque source', 'le tabelle di ogni source', 'die Tabellen jeder Source', 'de tabellen van elke source', 'les taules de cada source', 'as táboas de cada source', 'source bakoitzaren taulak'],
	['stageShowNames', 'the name of each source only', 'solo el nombre de cada source', 'só o nome de cada source', 'le nom de chaque source seulement', 'solo il nome di ogni source', 'nur den Namen jeder Source', 'alleen de naam van elke source', 'només el nom de cada source', 'só o nome de cada source', 'source bakoitzaren izena soilik'],
	['stageGatewayTop', 'the gateway on top, the sources below', 'el gateway arriba, los sources debajo', 'o gateway em cima, os sources embaixo', 'le gateway en haut, les sources en dessous', 'il gateway in alto, le source sotto', 'das Gateway oben, die Sources darunter', 'de gateway boven, de sources eronder', 'el gateway a dalt, els sources a sota', 'o gateway arriba, os sources debaixo', 'gateway-a goian, source-ak behean'],
	['stageGatewayLeft', 'the gateway on the left, the sources on the right', 'el gateway a la izquierda, los sources a la derecha', 'o gateway à esquerda, os sources à direita', 'le gateway à gauche, les sources à droite', 'il gateway a sinistra, le source a destra', 'das Gateway links, die Sources rechts', 'de gateway links, de sources rechts', 'el gateway a l’esquerra, els sources a la dreta', 'o gateway á esquerda, os sources á dereita', 'gateway-a ezkerrean, source-ak eskuinean'],
	['state', 'State', 'Estado', 'Estado', 'État', 'Stato', 'Zustand', 'Status', 'Estat', 'Estado', 'Egoera'],
	['sourceCode', 'Source code', 'Código fuente', 'Código-fonte', 'Code source', 'Codice sorgente', 'Quellcode', 'Broncode', 'Codi font', 'Código fonte', 'Iturburu-kodea'],
	['downloadZip', 'Download {name} as .zip', 'Descargar {name} como .zip', 'Baixar {name} como .zip', 'Télécharger {name} en .zip', 'Scarica {name} come .zip', '{name} als .zip herunterladen', '{name} als .zip downloaden', 'Baixa {name} com a .zip', 'Descargar {name} como .zip', 'Deskargatu {name} .zip gisa'],
	['rebuildCode', 'Build {name} again', 'Volver a generar {name}', 'Gerar {name} de novo', 'Régénérer {name}', 'Rigenera {name}', '{name} neu erzeugen', '{name} opnieuw genereren', 'Torna a generar {name}', 'Xerar {name} de novo', 'Sortu {name} berriro'],
	['removeCode', 'Delete {name}', 'Eliminar {name}', 'Excluir {name}', 'Supprimer {name}', 'Elimina {name}', '{name} löschen', '{name} verwijderen', 'Elimina {name}', 'Eliminar {name}', 'Ezabatu {name}'],
	['removeCodeConfirm', 'Delete the code {name} ({dir})? Its files go, the repositories written by hand too. It cannot be undone.', '¿Eliminar el código {name} ({dir})? Se van sus archivos, también los repositorios escritos a mano. No se puede deshacer.', 'Excluir o código {name} ({dir})? Os seus arquivos se vão, também os repositórios escritos à mão. Não pode ser desfeito.', 'Supprimer le code {name} ({dir}) ? Ses fichiers partent, les dépôts écrits à la main aussi. C’est irréversible.', 'Eliminare il codice {name} ({dir})? I suoi file se ne vanno, anche i repository scritti a mano. Non si può annullare.', 'Den Code {name} ({dir}) löschen? Seine Dateien gehen, auch die von Hand geschriebenen Repositories. Das kann nicht rückgängig gemacht werden.', 'De code {name} ({dir}) verwijderen? Zijn bestanden gaan weg, ook de met de hand geschreven repositories. Dit kan niet ongedaan worden.', 'Eliminar el codi {name} ({dir})? Se’n van els fitxers, també els repositoris escrits a mà. No es pot desfer.', 'Eliminar o código {name} ({dir})? Vanse os seus ficheiros, tamén os repositorios escritos a man. Non se pode desfacer.', '{name} kodea ({dir}) ezabatu? Bere fitxategiak joango dira, eskuz idatzitako biltegiak ere bai. Ezin da desegin.'],
	['rebuilt', '{name} built again: {n} files written (the repositories already there stay)', '{name} generado de nuevo: {n} archivos escritos (los repositorios que ya estaban quedan)', '{name} gerado de novo: {n} arquivos gravados (os repositórios que já estavam ficam)', '{name} régénéré : {n} fichiers écrits (les dépôts déjà là restent)', '{name} rigenerato: {n} file scritti (i repository già presenti restano)', '{name} neu erzeugt: {n} Dateien geschrieben (vorhandene Repositories bleiben)', '{name} opnieuw gegenereerd: {n} bestanden geschreven (bestaande repositories blijven)', '{name} generat de nou: {n} fitxers escrits (els repositoris que ja hi eren es queden)', '{name} xerado de novo: {n} ficheiros escritos (os repositorios que xa estaban quedan)', '{name} berriro sortua: {n} fitxategi idatzita (lehendik zeuden biltegiak geratzen dira)'],
	['removedCode', '{name} deleted', '{name} eliminado', '{name} excluído', '{name} supprimé', '{name} eliminato', '{name} gelöscht', '{name} verwijderd', '{name} eliminat', '{name} eliminado', '{name} ezabatuta'],
	['buildParts', 'What it generates', 'Qué genera', 'O que gera', 'Ce qu’il génère', 'Cosa genera', 'Was erzeugt wird', 'Wat het genereert', 'Què genera', 'Que xera', 'Zer sortzen duen'],
	['buildModel', 'the model (rewritten)', 'el modelo (se reescribe)', 'o modelo (reescrito)', 'le modèle (réécrit)', 'il modello (riscritto)', 'das Modell (neu geschrieben)', 'het model (herschreven)', 'el model (es reescriu)', 'o modelo (reescríbese)', 'eredua (berridazten da)'],
	['buildRepositories', 'the repositories (one already there stays)', 'los repositorios (uno que ya está queda)', 'os repositórios (um que já existe fica)', 'les dépôts (un déjà là reste)', 'i repository (uno già presente resta)', 'die Repositories (vorhandene bleiben)', 'de repositories (een bestaande blijft)', 'els repositoris (un que ja hi és es queda)', 'os repositorios (un que xa está queda)', 'biltegiak (lehendik dagoena geratzen da)'],
	['condition', 'Condition', 'Condición', 'Condição', 'Condition', 'Condizione', 'Bedingung', 'Voorwaarde', 'Condició', 'Condición', 'Baldintza'],
	['conditionHint', 'An expression, e.g. entity.in(["Products","Orders"]) && read — empty: the rest', 'Una expresión, p. ej. entity.in(["Products","Orders"]) && read — vacía: el resto', 'Uma expressão, p. ex. entity.in(["Products","Orders"]) && read — vazia: o resto', 'Une expression, p. ex. entity.in(["Products","Orders"]) && read — vide : le reste', 'Un’espressione, es. entity.in(["Products","Orders"]) && read — vuota: il resto', 'Ein Ausdruck, z. B. entity.in(["Products","Orders"]) && read — leer: der Rest', 'Een expressie, bv. entity.in(["Products","Orders"]) && read — leeg: de rest', 'Una expressió, p. ex. entity.in(["Products","Orders"]) && read — buida: la resta', 'Unha expresión, p. ex. entity.in(["Products","Orders"]) && read — baleira: o resto', 'Adierazpen bat, adib. entity.in(["Products","Orders"]) && read — hutsik: gainerakoa'],
	['expression', 'Expression', 'Expresión', 'Expressão', 'Expression', 'Espressione', 'Ausdruck', 'Expressie', 'Expressió', 'Expresión', 'Adierazpena'],
	['expressionsOf', 'Expressions of {name}', 'Expresiones de {name}', 'Expressões de {name}', 'Expressions de {name}', 'Espressioni di {name}', 'Ausdrücke von {name}', 'Expressies van {name}', 'Expressions de {name}', 'Expresións de {name}', '{name}(r)en adierazpenak'],
	['validationsHint', 'Checked by λORM before each insert and update (after writeValue): a condition that is false rejects the sentence with its message.', 'λORM las comprueba antes de cada insert y update (después de writeValue): una condición falsa rechaza la sentencia con su mensaje.', 'O λORM as verifica antes de cada insert e update (depois do writeValue): uma condição falsa rejeita a sentença com sua mensagem.', 'λORM les vérifie avant chaque insert et update (après writeValue) : une condition fausse rejette la requête avec son message.', 'λORM le verifica prima di ogni insert e update (dopo writeValue): una condizione falsa rifiuta l’istruzione con il suo messaggio.', 'λORM prüft sie vor jedem Insert und Update (nach writeValue): eine falsche Bedingung weist die Anweisung mit ihrer Meldung ab.', 'λORM controleert ze vóór elke insert en update (na writeValue): een onware voorwaarde weigert de opdracht met haar melding.', 'λORM les comprova abans de cada insert i update (després de writeValue): una condició falsa rebutja la sentència amb el seu missatge.', 'λORM compróbaas antes de cada insert e update (despois de writeValue): unha condición falsa rexeita a sentenza coa súa mensaxe.', 'λORMek insert eta update bakoitzaren aurretik egiaztatzen ditu (writeValue ondoren): baldintza faltsu batek sententzia baztertzen du bere mezuarekin.'],
	['helpReadExp', 'Replaces the column when reading: λORM translates it into the query (SQL) and the property returns its result. E.g. mask(email), concat(lastname,", ",firstname).', 'Reemplaza la columna al leer: λORM la traduce a la consulta (SQL) y la propiedad devuelve su resultado. Ej.: mask(email), concat(lastname,", ",firstname).', 'Substitui a coluna ao ler: o λORM a traduz para a consulta (SQL) e a propriedade devolve o seu resultado. Ex.: mask(email), concat(lastname,", ",firstname).', 'Remplace la colonne à la lecture : λORM la traduit dans la requête (SQL) et la propriété renvoie son résultat. Ex. : mask(email), concat(lastname,", ",firstname).', 'Sostituisce la colonna in lettura: λORM la traduce nella query (SQL) e la proprietà restituisce il suo risultato. Es.: mask(email), concat(lastname,", ",firstname).', 'Ersetzt die Spalte beim Lesen: λORM übersetzt sie in die Abfrage (SQL), und die Eigenschaft liefert ihr Ergebnis. Z. B. mask(email), concat(lastname,", ",firstname).', 'Vervangt de kolom bij het lezen: λORM vertaalt haar naar de query (SQL) en de eigenschap geeft haar resultaat. Bv. mask(email), concat(lastname,", ",firstname).', 'Substitueix la columna en llegir: λORM la tradueix a la consulta (SQL) i la propietat en retorna el resultat. P. ex.: mask(email), concat(lastname,", ",firstname).', 'Substitúe a columna ao ler: λORM tradúcea á consulta (SQL) e a propiedade devolve o seu resultado. P. ex.: mask(email), concat(lastname,", ",firstname).', 'Irakurtzean zutabea ordezten du: λORMek kontsultara (SQL) itzultzen du eta propietateak bere emaitza itzultzen du. Adib.: mask(email), concat(lastname,", ",firstname).'],
	['helpWriteExp', 'Meant for what is written in the column, but λORM 3.8 does not apply it: use writeValue.', 'Pensada para lo que se escribe en la columna, pero λORM 3.8 no la aplica: usa writeValue.', 'Pensada para o que se escreve na coluna, mas o λORM 3.8 não a aplica: use writeValue.', "Prévue pour ce qui est écrit dans la colonne, mais λORM 3.8 ne l'applique pas : utilisez writeValue.", 'Pensata per ciò che si scrive nella colonna, ma λORM 3.8 non la applica: usa writeValue.', 'Gedacht für das, was in die Spalte geschrieben wird, aber λORM 3.8 wendet sie nicht an: nutze writeValue.', 'Bedoeld voor wat in de kolom wordt geschreven, maar λORM 3.8 past haar niet toe: gebruik writeValue.', "Pensada per al que s'escriu a la columna, però λORM 3.8 no l'aplica: fes servir writeValue.", 'Pensada para o que se escribe na columna, pero λORM 3.8 non a aplica: usa writeValue.', 'Zutabean idazten denerako pentsatua, baina λORM 3.8k ez du aplikatzen: erabili writeValue.'],
	['helpReadValue', 'Transforms each value after reading it, in the gateway (not in the database). E.g. decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor después de leerlo, en el gateway (no en la base de datos). Ej.: decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor depois de lê-lo, no gateway (não no banco de dados). Ex.: decrypt(email,$DATA_SECRET_KEY).', 'Transforme chaque valeur après sa lecture, dans le gateway (pas dans la base de données). Ex. : decrypt(email,$DATA_SECRET_KEY).', 'Trasforma ogni valore dopo averlo letto, nel gateway (non nel database). Es.: decrypt(email,$DATA_SECRET_KEY).', 'Wandelt jeden Wert nach dem Lesen um, im Gateway (nicht in der Datenbank). Z. B. decrypt(email,$DATA_SECRET_KEY).', 'Zet elke waarde om na het lezen, in de gateway (niet in de database). Bv. decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor després de llegir-lo, al gateway (no a la base de dades). P. ex.: decrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor despois de lelo, no gateway (non na base de datos). P. ex.: decrypt(email,$DATA_SECRET_KEY).', 'Balio bakoitza irakurri ondoren eraldatzen du, gatewayan (ez datu-basean). Adib.: decrypt(email,$DATA_SECRET_KEY).'],
	['helpWriteValue', 'Transforms each value before writing it (insert, update), in the gateway; the constraints see its result. E.g. encrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor antes de escribirlo (insert, update), en el gateway; las constraints ven su resultado. Ej.: encrypt(email,$DATA_SECRET_KEY).', 'Transforma cada valor antes de escrevê-lo (insert, update), no gateway; as constraints veem o seu resultado. Ex.: encrypt(email,$DATA_SECRET_KEY).', "Transforme chaque valeur avant de l'écrire (insert, update), dans le gateway ; les constraints voient son résultat. Ex. : encrypt(email,$DATA_SECRET_KEY).", 'Trasforma ogni valore prima di scriverlo (insert, update), nel gateway; le constraints vedono il suo risultato. Es.: encrypt(email,$DATA_SECRET_KEY).', 'Wandelt jeden Wert vor dem Schreiben um (Insert, Update), im Gateway; die Constraints sehen sein Ergebnis. Z. B. encrypt(email,$DATA_SECRET_KEY).', 'Zet elke waarde om vóór het schrijven (insert, update), in de gateway; de constraints zien het resultaat. Bv. encrypt(email,$DATA_SECRET_KEY).', "Transforma cada valor abans d'escriure'l (insert, update), al gateway; les constraints en veuen el resultat. P. ex.: encrypt(email,$DATA_SECRET_KEY).", 'Transforma cada valor antes de escribilo (insert, update), no gateway; as constraints ven o seu resultado. P. ex.: encrypt(email,$DATA_SECRET_KEY).', 'Balio bakoitza idatzi aurretik eraldatzen du (insert, update), gatewayan; constraintek bere emaitza ikusten dute. Adib.: encrypt(email,$DATA_SECRET_KEY).'],
	['addSource', 'Add source', 'Agregar source', 'Adicionar source', 'Ajouter une source', 'Aggiungi source', 'Source hinzufügen', 'Source toevoegen', 'Afegeix source', 'Engadir source', 'Gehitu source'],
	['moveUp', 'Move up', 'Subir', 'Subir', 'Monter', 'Sposta su', 'Nach oben', 'Omhoog', 'Puja', 'Subir', 'Gora'],
	['moveDown', 'Move down', 'Bajar', 'Descer', 'Descendre', 'Sposta giù', 'Nach unten', 'Omlaag', 'Baixa', 'Baixar', 'Behera'],
	['notAVariable', '{name}: not a variable of a sentence ({names})', '{name}: no es una variable de una sentencia ({names})', '{name}: não é uma variável de uma sentença ({names})', '{name} : pas une variable d’une phrase ({names})', '{name}: non è una variabile di una frase ({names})', '{name}: keine Variable eines Satzes ({names})', '{name}: geen variabele van een zin ({names})', '{name}: no és una variable d’una sentència ({names})', '{name}: non é unha variable dunha sentenza ({names})', '{name}: ez da sententzia baten aldagaia ({names})'],
	['rootTaken', 'The schema at the root (/) is the only one the gateway can serve: move it to a folder of the workspace to add others.', 'El esquema de la raíz (/) es el único que la gateway puede servir: movelo a una carpeta del workspace para agregar otros.', 'O esquema da raiz (/) é o único que a gateway pode servir: mova-o para uma pasta do workspace para adicionar outros.', 'Le schéma à la racine (/) est le seul que la gateway peut servir : déplacez-le dans un dossier du workspace pour en ajouter d’autres.', 'Lo schema alla radice (/) è l’unico che il gateway può servire: spostalo in una cartella del workspace per aggiungerne altri.', 'Das Schema im Stamm (/) ist das einzige, das das Gateway bedienen kann: verschieben Sie es in einen Ordner des Workspace, um weitere hinzuzufügen.', 'Het schema in de root (/) is het enige dat de gateway kan bedienen: verplaats het naar een map van de workspace om er meer toe te voegen.', 'L’esquema de l’arrel (/) és l’únic que la gateway pot servir: mou-lo a una carpeta del workspace per afegir-ne d’altres.', 'O esquema da raíz (/) é o único que a gateway pode servir: móveo a un cartafol do workspace para engadir outros.', 'Erroko (/) eskema da gateway-k zerbitzatu dezakeen bakarra: eraman workspace-ko karpeta batera beste batzuk gehitzeko.'],
	['metadata', 'Metadata', 'Metadatos', 'Metadados', 'Métadonnées', 'Metadati', 'Metadaten', 'Metadata', 'Metadades', 'Metadatos', 'Metadatuak'],
	['openSchema', 'Open {name}: its commands', 'Abrir {name}: sus comandos', 'Abrir {name}: seus comandos', 'Ouvrir {name} : ses commandes', 'Apri {name}: i suoi comandi', '{name} öffnen: seine Befehle', '{name} openen: de opdrachten', 'Obre {name}: les seves ordres', 'Abrir {name}: os seus comandos', 'Ireki {name}: bere komandoak'],
	['contextVariables', 'Variables of the sentence', 'Variables de la sentencia', 'Variáveis da sentença', 'Variables de la phrase', 'Variabili della frase', 'Variablen des Satzes', 'Variabelen van de zin', 'Variables de la sentència', 'Variables da sentenza', 'Sententziaren aldagaiak'],
	['insertIt', 'Insert {name}', 'Insertar {name}', 'Inserir {name}', 'Insérer {name}', 'Inserisci {name}', '{name} einfügen', '{name} invoegen', 'Insereix {name}', 'Inserir {name}', 'Txertatu {name}'],
	['expressionKeys', 'Ctrl+Space: suggestions (variables, functions; inside quotes the entities and the values)', 'Ctrl+Espacio: sugerencias (variables, funciones; dentro de comillas las entidades y los valores)', 'Ctrl+Espaço: sugestões (variáveis, funções; entre aspas as entidades e os valores)', 'Ctrl+Espace : suggestions (variables, fonctions ; entre guillemets les entités et les valeurs)', 'Ctrl+Spazio: suggerimenti (variabili, funzioni; tra virgolette le entità e i valori)', 'Strg+Leertaste: Vorschläge (Variablen, Funktionen; in Anführungszeichen die Entitäten und Werte)', 'Ctrl+Spatie: suggesties (variabelen, functies; tussen aanhalingstekens de entiteiten en waarden)', 'Ctrl+Espai: suggeriments (variables, funcions; entre cometes les entitats i els valors)', 'Ctrl+Espazo: suxestións (variables, funcións; entre comiñas as entidades e os valores)', 'Ctrl+Zuriunea: iradokizunak (aldagaiak, funtzioak; komatxo artean entitateak eta balioak)'],
	['apply', 'Apply', 'Aplicar', 'Aplicar', 'Appliquer', 'Applica', 'Übernehmen', 'Toepassen', 'Aplica', 'Aplicar', 'Aplikatu'],
	['editCondition', 'Edit the condition of {name}', 'Editar la condición de {name}', 'Editar a condição de {name}', 'Modifier la condition de {name}', 'Modifica la condizione di {name}', 'Bedingung von {name} bearbeiten', 'Voorwaarde van {name} bewerken', 'Edita la condició de {name}', 'Editar a condición de {name}', 'Editatu {name}-ren baldintza'],
	['conditionOf', 'Condition of {name}', 'Condición de {name}', 'Condição de {name}', 'Condition de {name}', 'Condizione di {name}', 'Bedingung von {name}', 'Voorwaarde van {name}', 'Condició de {name}', 'Condición de {name}', '{name}-ren baldintza'],
	['theRest', 'no condition: the rest', 'sin condición: el resto', 'sem condição: o resto', 'sans condition : le reste', 'senza condizione: il resto', 'ohne Bedingung: der Rest', 'geen voorwaarde: de rest', 'sense condició: la resta', 'sen condición: o resto', 'baldintzarik gabe: gainerakoa'],
	['current', 'current', 'actual', 'atual', 'actuelle', 'attuale', 'aktuell', 'huidige', 'actual', 'actual', 'unekoa']
)

const ORDER: Locale[] = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'ca', 'gl', 'eu']

const BY_LOCALE = Object.fromEntries(ORDER.map((locale, i) => [locale, Object.fromEntries(ROWS.map(row => [row[0], row[i + 1]])) as unknown as AdminMessages])) as Record<Locale, AdminMessages>

export const adminMessagesOf = (locale: string | undefined): AdminMessages =>
	BY_LOCALE[locale as Locale] ?? BY_LOCALE[(locale ?? '').slice(0, 2) as Locale] ?? BY_LOCALE.en

export { format }
