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

const ORDER: Locale[] = ['en', 'es', 'pt', 'fr', 'it', 'de', 'nl', 'ca', 'gl', 'eu']

const BY_LOCALE = Object.fromEntries(ORDER.map((locale, i) => [locale, Object.fromEntries(ROWS.map(row => [row[0], row[i + 1]])) as unknown as AdminMessages])) as Record<Locale, AdminMessages>

export const adminMessagesOf = (locale: string | undefined): AdminMessages =>
	BY_LOCALE[locale as Locale] ?? BY_LOCALE[(locale ?? '').slice(0, 2) as Locale] ?? BY_LOCALE.en

export { format }
