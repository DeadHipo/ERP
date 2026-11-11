"""English text for the Schedules register sent to the purchaser (v10: no transliteration).

The internal book is written in Russian. The book sent out repeats its Schedule sheets in English: sheet names
and headers by table, generated phrases by table (longest first, short words only as whole words), quotations of
Russian contract text replaced by a pointer to the agreement, and what is left in Cyrillic (titles, artist names,
file names) transliterated. Nothing here names a person: owner decisions carry their English text in the
decisions file.
"""

from __future__ import annotations

import re

CYRILLIC = re.compile("[\u0400-\u04FF]")
LETTER = "\u0400-\u04FF"
# columns that quote the agreements: a clause in Russian or Ukrainian is not translated, it is pointed to
QUOTES = {"Renewal and notice", "Reversion", "Material restrictions", "Assignment clause", "Escalators",
          "Reporting and payment deadlines", "Withholding", "Calculation basis", "Continuing limitation / treatment",
          "Approvals for individual uses", "Permitted deductions"}

SHEETS = {
    "Schedule map": "Schedule map",
    "Sch1A Каталог": "Sch1A Catalogue register",
    "Sch1B Исключения": "Sch1B Excluded register",
    "Sch1C Ассеты": "Sch1C Ancillary materials",
    "Sch2A Договоры": "Sch2A Agreements register",
    "Sch2A Пакеты артистов": "Sch2A Artist packages",
    "Sch2B Контрибьюторы": "Sch2B Contributor licences",
    "Sch2C Согласия": "Sch2C Required consents",
    "Sch2D Ограничения": "Sch2D Accepted limitations",
    "Sch3A Роялти": "Sch3A Royalty register",
    "Sch3A Участия вне сплита": "Sch3A Participations",
    "Sch3A Комиссии": "Sch3A Payment costs",
    "Sch3B Авансы": "Sch3B Advances",
    "Sch3C Финансы": "Sch3C Reference financials",
    "Sch3C (i) Участия": "Sch3C (i) Participations",
    "Sch3C (ii) Выкупы": "Sch3C (ii) Buy-outs",
    "Sch3D Обязательства": "Sch3D Assumed obligations",
    "Sch4A Претензии": "Sch4A Known claims",
    "Sch4B Документация": "Sch4B Documentation matters",
    "Sch4C Отложенные": "Sch4C Deferred items",
    "Sch4D Цепочка": "Sch4D Legacy instruments",
    "Sch4D Охват": "Sch4D Coverage",
    "Sch5 Раскрытие": "Sch5 Disclosure",
    "Sch6 Банк": "Sch6 Bank details",
}
# internal working sheets: not sent
NOT_SENT = {"П8 Не классифицировано", "Фронтлайн Продукты"}

HEADERS = {
    "Schedule / Part": "Schedule / Part", "Что требует договор": "What the Agreement requires",
    "Где в этой книге": "Where in this workbook", "Статус сборки": "Status",
    "ISRC": "ISRC", "Запись и версия": "Recording and version", "Тип продукта": "Product",
    "Категория права": "Rights category", "Приобретаемая доля (юридический интерес)": "Acquired share (legal interest)",
    "Основание доли": "Basis of the acquired share", "Договорный пакет (Sch 2)": "Contractual package (Schedule 2)",
    "Срок": "Term", "Территория": "Territory", "Разрешённый объём": "Permitted scope",
    "Как запись идентифицирована": "How the recording is identified", "Покрытие": "Coverage status",
    "Запись": "Recording", "Артисты": "Artists", "Категория исключения": "Excluded category",
    "Причина и источник": "Reason and source", "Категория": "Category", "Приобретаемый интерес": "Interest acquired",
    "Что есть в данных": "Position in the records",
    "Договор": "Agreement", "Тип": "Type", "Стороны": "Parties", "Поправки и приложения": "Amendments and schedules",
    "Предоставленные права": "Rights granted", "Приобретаемая доля": "Acquired share",
    "Продление и уведомление": "Renewal and notice", "Реверсия": "Reversion",
    "Существенные ограничения": "Material restrictions", "Уступка по тексту договора": "Assignment clause",
    "Способ передачи (п. 2.3–2.5)": "Transfer mechanism (clauses 2.3–2.5)",
    "Согласие на сделку": "Transaction Consent", "Одобрения отдельных использований": "Approvals for individual uses",
    "Распределение обязательств": "Allocated obligations", "Статус редакции": "Superseded status",
    "Подписание": "Execution", "Записей в периметре": "Recordings acquired",
    "Записей вне периметра": "Recordings excluded",
    "Артист": "Artist", "Действующие договоры и приложения": "Operative agreements and schedules",
    "Заменённые редакции": "Superseded versions", "Записей вне периметра в этих договорах":
        "Excluded recordings named in these agreements", "Единица передачи": "Transfer unit",
    "Контрибьютор или договор": "Contributor / agreement", "Основание": "Basis",
    "Записи": "Recordings / contractual package", "Режим передачи": "Transfer treatment",
    "Риск по п. 6.6.1": "Clause 6.6.1",
    "Договорённость": "Arrangement", "Требуемое согласие": "Consent required",
    "Действие к Completion": "Required Completion treatment", "Источник": "Source",
    "Конкретное ограничение": "Continuing limitation / treatment", "Статус": "Status",
    "Получатель": "Recipient", "Идентификатор получателя": "Recipient identifier (party_id)",
    "База расчёта": "Calculation basis", "Ставка, %": "Rate, %", "Сумма за период, $": "Amount for the period, US$",
    "Эскалаторы": "Escalators", "Разрешённые удержания": "Permitted deductions",
    "Сроки отчётов и выплат": "Reporting and payment deadlines", "Налоговое удержание": "Withholding",
    "Авансы": "Advances", "Чьё обязательство": "Allocation of the obligation",
    "Учтено один раз": "Recorded once", "Период": "Period", "Отражено в сплите": "Reflected in the registered split",
    "Записей": "Recordings", "Правило": "Rule", "Статья": "Item", "Ставка": "Rate", "Режим": "Treatment",
    "Категория баланса": "Balance category", "Режим на Completion": "Completion treatment",
    "Строка договора": "Agreed financial reference", "Значение": "Particulars",
    "Сумма за период, $ ": "Amount for the period, US$", "Выкупы": "Instruments",
    "Доля лейбла без выкупов, $": "Net Label Share without the buy-outs, US$",
    "Прибавка от выкупов, $": "Adjustment from buy-outs, US$",
    "Обязательство": "Obligation", "Претензия": "Claim / matter",
    "Затронутые записи и режим": "Affected repertoire and contractual treatment",
    "Вопрос": "Matter", "Требуемое действие и защита": "Required action and protection",
    "Пункт и затронутые права": "Item and affected rights", "Допустимый временный режим": "Permitted interim treatment",
    "Действие и срок": "Action and final deadline", "Цедент": "Transferor to the Seller",
    "Документ": "Instrument / subject matter", "Записей в периметре по тексту документа":
        "Acquired recordings named in the instrument", "Документ цепочки": "Instrument",
    "Запись раскрытия / гарантия": "Entry / affected warranty",
    "Конкретное раскрытие": "Specific disclosure and limited effect", "Ссылка на документ": "Supporting reference",
    "Реквизит": "Particulars", "Дата документа": "Date of the document", "Сумма за период": "Amount for the period, US$",
}
# columns that hold titles and file names: never translated, only transliterated
IDENTIFIERS = {"ISRC", "Recording and version", "Recording", "Artists", "Agreement",
               "Operative agreements and schedules", "Superseded versions", "Instrument",
               "Contractual package (Schedule 2)", "Instrument / subject matter", "Arrangement"}
# columns that hold names of people or labels, sometimes with a generated note: the note is translated,
# the name transliterated
NAMES = {"Recipient", "Parties", "Artist", "Contributor / agreement", "Transferor to the Seller"}
# per sheet header where the shared table does not fit
SHEET_HEADERS = {"Sch6 Банк": ["Particulars", "Details"]}
# Latin wording of the working file that does not belong in the register sent out
LATIN = [("(Annex 14 beta, Sch1B)", "(Annex 14, Excluded register)"), ("Annex 14 beta", "Annex 14")]
# generated wording that may stand in a column of names: translated only as the whole cell or as a known suffix
NAME_FRAGMENTS = (": до", "урегулировано мировым соглашением", "участники не названы в источнике",
                  "не участник сплита", "цепочка на FZ")

# generated Russian phrases and their English text; applied longest first
PHRASES = {
    "собственный мастер-копирайт": "owned master copyright",
    "эксклюзивные контрактные права эксплуатации на фиксированный срок":
        "exclusive contractual exploitation rights for a fixed term",
    "эксклюзивные контрактные права эксплуатации на срок охраны":
        "exclusive contractual exploitation rights for the life of copyright",
    "неэксклюзивные поддерживающие права контрибьютора или сэмпла":
        "non-exclusive supporting contributor or sample rights",
    "назван трек без версии": "track title named without the version",
    "ISRC назван": "ISRC named", "назван трек": "track title named", "назван релиз": "release title named",
    "только по артисту": "artist agreement only, recording not named",
    "не идентифицирована": "not identified",
    "собственная запись лейбла: договор с участником не нужен": "label's own recording: no participant agreement needed",
    "только договор с артистом, запись не названа": "artist agreement only, recording not named",
    "co-author named in another party's agreement, none of its own":
        "co-author named in another party's agreement, none of its own",
    "covered: документ называет ISRC, сторона не участник сплита":
        "covered: an instrument names the ISRC; its party is not on the split",
    "не установлено: нет документа, который называет запись": "not established: no document names the recording",
    "не установлено: нет документа": "not established: no document",
    "не установлено: из типа документа передача прав не следует":
        "not established: the type of document does not show a transfer of rights",
    "не установлено: доля частичного выкупа по документу не извлечена":
        "not established: the share acquired by the partial buy-out is not extracted from the document",
    "не установлено: доля по договору совместного владения не извлечена":
        "not established: the co-ownership share is not extracted from the document",
    "не применимо: лицензия третьего лица на сэмпл или вокал, это ограничение, а не наша доля":
        "not applicable: a third-party sample or vocal licence is a limitation, not an acquired share",
    "эксклюзивная лицензия на распространение и администрирование на срок договора, права не переходят":
        "exclusive distribution and administration licence for the term of the agreement; title does not pass",
    "правило владельца 02.11.2026 по типу основания": "Seller's rule of 2 November 2026 by type of instrument",
    "выкуп всей доли:": "buy-out of the whole interest:",
    "выкуп части доли (реестр выкупов, seller_pct):": "buy-out of part of the interest (buy-out register):",
    "права у FZ по документу:": "title vested in FZ by:",
    "собственная запись лейбла, цепочка на FZ:": "label's own recording, chain of title to FZ:",
    "нет документа (статус на 02.11.2026)": "no underlying agreement (status at 2 November 2026)",
    "не установлено: названия нет в источниках": "not established: title not in the sources",
    "не установлено: сторона не распознана": "not established: party not identified",
    "не установлено: дата не указана в имени файла": "not established: no date in the file name",
    "договоры с артистами, где названы записи вне периметра":
        "artist agreements that name recordings outside the perimeter",
    "записи с кредитом продавцов Duetti, оставленные в периметре":
        "recordings credited to a Duetti seller that remain in the perimeter",
    "не применимо: собственный мастер-копирайт": "not applicable: owned master copyright",
    "не установлено: срок не найден в тексте документов записи":
        "not established: no term in the text of the recording's documents",
    "не установлено: территория не найдена в тексте документов записи":
        "not established: no territory in the text of the recording's documents",
    "не установлено: ограничений по медиа, синхронизации и производным в тексте не найдено":
        "not established: no media, synchronisation or derivative-use limitation found in the text",
    "лет с даты договора": "years from the date of the agreement",
    "на срок охраны": "life of copyright", "весь мир": "worldwide",
    "синхронизация": "synchronisation", "физические носители": "physical formats", "производные": "derivative use",
    "имя и изображение": "name and likeness", "перезапись": "re-recording", "согласие": "consent",
    "audio (источник: Annex 14 beta, Splits by ISRC)": "audio (source: Annex 14, Splits by ISRC)",
    "не установлено: строк в отчётах Believe нет, нужен экспорт Backstage":
        "not established: no Believe statement lines",
    # Sch1B
    "Duetti: ISRC в Schedule 1 договора продажи": "sold to Duetti, Schedule 1 to the Master Purchase Agreement",
    "Echo8: в аккаунте 1052428 все строки под импринтом Echo8": "Echo8 imprint in every Believe statement line",
    "(Annex 14 beta, Sch1B)": "(Annex 14, Excluded register)",
    "контроль": "control",
    "записи с кредитом продавцов Duetti, оставленные в периметре":
        "recordings credited to a Duetti seller that remain acquired",
    "не исключены только по кредиту (Sch 1 B)": "not excluded by that credit alone (Schedule 1 Part B)",
    # Sch1C
    "собственные права на обложки и промо по реестру доставки ассетов":
        "the Seller's owned copyright in artwork and promotional assets per the asset-delivery register",
    "не установлено: реестра доставки ассетов (asset-delivery register) в данных нет; обложек и видео нет":
        "not established: no asset-delivery register in the records; no artwork or video files",
    "договорные разрешения на имена и образы артистов": "contractual permissions for artist names and likenesses",
    "пункт об имени и образе найден в тексте": "a name-and-likeness clause appears in the text of",
    "договоров; остальные — не установлено": "agreements; for the others not established",
    "мастер-файлы, стемы, метаданные, учёт прав и роялти": "master files, stems, metadata, rights and royalty records",
    "мастер-файлов в выгрузке Zero:": "master files in the Zero delivery export:",
    "отгрузкам; стемов нет; метаданные и роялти — эта книга":
        "deliveries; no stems; metadata and royalty records: this workbook",
    # Sch2A
    "договор с артистом": "artist agreement", "приложение SCHEDULE": "artist schedule", "выкуп": "buy-out",
    "уступка на FZ по цепочке": "assignment to FZ in the chain of title", "уступка": "assignment",
    "лицензия на сэмпл": "sample licence", "лицензия контрибьютора": "contributor licence",
    "изменение или приложение": "amendment", "мировое соглашение": "settlement agreement",
    "работа по найму": "work for hire", "договор о совместном владении": "co-ownership agreement",
    "соглашение об участии в роялти": "royalty participation agreement", "саблейбл": "sub-label agreement",
    "продажа записей Duetti": "sale of recordings to Duetti", "продажа записей": "sale of recordings",
    "исключительная лицензия на запись и распространение": "exclusive recording and distribution licence",
    "перечень записей к договору с артистом": "schedule of recordings to the artist agreement",
    "уступка исключительных прав на записи": "assignment of exclusive rights in the recordings",
    "уступка на FZ по цепочке титула": "assignment to FZ in the chain of title",
    "выкуп прав на записи": "buy-out of rights in the recordings", "выкуп части прав": "buy-out of part of the rights",
    "разрешение на производную запись": "derivative authorisation", "разрешение на сэмпл или вокал":
        "sample or vocal licence", "результат работ по найму": "work for hire", "участие в роялти":
        "royalty participation", "изменение договора": "amendment", "совместное владение": "co-ownership",
    "не найдено: других документов с тем же номером нет": "none found: no other document carries the same number",
    "ставка артиста по таблице:": "artist rate in the schedule table:",
    "% net (не юридическая доля)": "% of net (an economic rate, not a legal interest)",
    "не установлено: доля в тексте не извлечена": "not established: no share extracted from the text",
    "не установлено: срок в тексте не найден": "not established: no term found in the text",
    "не установлено: пункт о продлении в тексте не найден": "not established: no renewal clause found in the text",
    "не найдено: пункта о реверсии в тексте нет": "none found: the text has no reversion clause",
    "не установлено: территория в тексте не найдена": "not established: no territory found in the text",
    "в тексте не найдено: ограничений по медиа, синхронизации, физике, производным, имени":
        "none found in the text: no media, synchronisation, physical, derivative-use or name limitation",
    "лейбл вправе уступить права по договору только целиком лицу, принимающему обязательства, без согласия артиста":
        "the label may assign its rights under the agreement only in whole, to a party who agrees to be obligated, "
        "without the artist's consent",
    "лейбл вправе уступить договор целиком или частично без согласия артиста":
        "the label may assign the agreement in whole or in part without the artist's consent",
    "по тексту: «": "per the text: «",
    "не установлено: пункт об уступке не найден": "not established: no assignment clause found",
    "не назначен: решение по сделке (уступка целиком, каталожной части, сублицензия или новация)":
        "not yet designated: a transaction decision (assignment in whole, of the Catalogue portion, sublicence or "
        "novation)",
    "не требуется для уступки договора целиком; для уступки каталожной части (п. 2.5) — нужно согласие артиста":
        "not required for an assignment of the agreement in whole; the artist's consent is required for an "
        "assignment of the Catalogue portion (clause 2.5)",
    "; договор называет": "; the agreement names", "записей вне периметра — целиком без выделения не передаётся":
        "excluded recordings, so it cannot pass in whole without a carve-out",
    "не требуется: договор разрешает уступку целиком или частично":
        "not required: the agreement permits assignment in whole or in part",
    "не установлено: пункт об уступке не распознан": "not established: the assignment clause is not recognised",
    "не установлено: проверить пункт об уступке лицензии (Sch 2 C)":
        "not established: the licence's assignment clause to be checked (Schedule 2 Part C)",
    "не применимо: документ не передаётся покупателю как договор, он подтверждает титул":
        "not applicable: the instrument evidences title and is not transferred as a contract",
    "в тексте не найдено": "none found in the text",
    "не распределено: решение по сделке (п. 2.5.1)": "not yet allocated: a transaction decision (clause 2.5.1)",
    "не распределено": "not yet allocated", "не назначен": "not yet designated",
    "заменён:": "superseded by:",
    "не установлено: файла нет, редакция не проверена": "not established: no file; version not checked",
    "действующая редакция: более поздней редакции с теми же записями не найдено":
        "operative version: no later version covering the same recordings",
    "не определено: несколько редакций с одной датой подписи (пробел 10)":
        "not determined: several versions executed on the same date",
    "подписан всеми": "executed by all parties", "подписан одной стороной": "executed by one party",
    "не подписан": "not executed", "не установлено: подпись вне PandaDoc": "executed outside PandaDoc; not verified",
    "не проверено: файла нет": "not verified: no file",
    "нет документа": "no underlying agreement",
    # packages
    "нет действующей редакции": "no operative version",
    "каталожная часть с согласием артиста (п. 2.5): договоры называют исключённые записи —":
        "Catalogue portion with the artist's consent (clause 2.5): the agreements name excluded recordings —",
    "договор целиком: исключённых записей договоры не называют":
        "the whole agreement: the agreements name no excluded recording",
    "; ещё": "; a further",
    "записей из договоров нет ни в отчётах Believe, ни в периметре — проверить, выпускались ли":
        "recordings in the agreements are neither in the Believe statements nor acquired; release to be checked",
    "; будущие релизы по договору зарезервированы продавцом — проверить":
        "; Future Releases under the agreement are reserved to the Seller — to be considered",
    "иное": "other", "отозвана": "withdrawn",
    # Sch2B
    "лицензия контрибьютора или сэмпла": "contributor or sample licence",
    "назван соавтором только в договоре другой стороны": "credited only in another party's agreement",
    "только зарегистрированный сплит, документа нет": "registered split only; no instrument",
    "не назначен: сублицензия или уступка по решению сделки (п. 2.7)":
        "not yet designated: sublicence or assignment as decided for the transaction (clause 2.7)",
    "нет: есть документ": "no: an instrument exists",
    "да: кредит или сплит не заменяет предоставление прав":
        "yes: a credit or royalty split is not a substitute for a rights grant",
    # Sch2C / 2D
    "получить до Completion (п. 2.6.1)": "to be obtained before Completion (clause 2.6.1)",
    "договоры с артистами, где названы записи вне периметра": "artist agreements naming excluded recordings",
    "согласие артиста на уступку каталожной части, договор называет исключённые записи (Echo8, Duetti, отозванные): "
    "таких артистов": "artist's consent to the assignment of the Catalogue portion where the agreement names "
                      "excluded recordings (Echo8, Duetti, withdrawn): artists concerned:",
    "(лист «Sch2A Пакеты артистов»)": "(sheet \"Sch2A Artist packages\")",
    "решить по каждому пакету": "to be decided per package",
    "текст договоров: уступка разрешена только целиком": "agreement text: assignment permitted only in whole",
    "все договоры": "all agreements",
    "ни одно ограничение пока не принято покупателем (Sch 2 D)":
        "none proposed yet: no limitation has been accepted by the Purchaser (Schedule 2 Part D)",
    "не согласовано": "not agreed", "кандидат: не принято покупателем": "candidate: not accepted by the Purchaser",
    # Sch3A
    "net Believe, аккаунт 1052428, отчётный месяц": "net receipts from Believe, account 1052428, by reporting month",
    "; по договору: «": "; per the agreement: «",
    "не предусмотрены: в тексте договора нет": "none: the agreement provides none",
    "не установлено: нет договора-основания": "not established: no underlying agreement",
    "только по Sch 3 A: НДС, комиссии каналов (EasyStaff 6%, Tipalti 0,5%), возвраты":
        "only those in Schedule 3 Part A: VAT, payment channel charges (EasyStaff 6%, Tipalti 0.5%), refunds",
    "не установлено: пункт в тексте не найден": "not established: no such clause in the text",
    "покупатель фондирует выплаты с поступлений после Completion (п. 5, Sch 3 D)":
        "the Purchaser funds payments from receipts on or after Completion (clause 5, Schedule 3 Part D)",
    "да: зарегистрированный сплит, вычитается один раз": "yes: registered split, deducted once",
    "да: вне зарегистрированного сплита, из доли лейбла один раз":
        "yes: outside the registered split, deducted once from the label share",
    "не рассчитан: нет поступлений": "not calculated: no receipts", "да, по Catalog Shares": "yes, Catalog Shares register",
    "нет: ставка изменена": "no: the rate differs from the registered split",
    "нет: доля лейбла изменена": "no: the label share differs from the registered split",
    "нет party_id: участие вне зарегистрированного сплита":
        "no party_id: participation outside the registered split",
    "не установлено: ставка в договоре не извлечена": "not established: no rate extracted from the agreement",
    "не рассчитано: ставки нет": "not calculated: no rate",
    "финальный сплит 0to8_Splits_20260814, sum_rates: доля net, которая остаётся лейблу после ставок участников; "
    "это не процент владения фонограммой":
        "registered split 0to8_Splits_20260814: the share of net left to the label after the participants' rates; "
        "not a percentage of copyright ownership",
    "финальный сплит 0to8_Splits_20260814": "registered split 0to8_Splits_20260814",
    ", доля лейбла": ", label share", "; реестр выкупов erp.db": "; buy-out register",
    "участники не названы в источнике": "participants not named in the source",
    "Annex 14, Splits by ISRC:": "Annex 14, Splits by ISRC:",
    "(Annex 14, Derivative authorisations): доля сверху, остальные пропорционально":
        "(Annex 14, Derivative authorisations): taken from the whole of net, the others in proportion",
    "ставка в месяцах с поступлениями, % net:": "rate in the months with receipts, % of net:",
    ": до": ": before", "урегулировано мировым соглашением": "settled under the settlement agreement",
    "лейбл": "label", "да": "yes", "нет": "no", "от": "of",
    "EasyStaff": "EasyStaff", "Tipalti": "Tipalti",
    "фондирует покупатель сверх суммы получателю (Sch 3 A b)":
        "funded by the Purchaser in addition to the recipient amount (Schedule 3 Part A (b))",
    "Комиссия Future Distribution Agreement 15%": "Future Distribution Agreement fee of 15%",
    "к каталогу не применяется (Sch 3 A)": "does not apply to the acquired Catalogue (Schedule 3 Part A)",
    # Sch3C
    ": последний закрытый отчётный месяц в данных; на Completion продлить до последнего закрытого месяца "
    "(гарантия 6.9.4)": ": the last closed reporting month in the records; to be extended at Completion to the last "
                         "closed month (warranty 6.9.4)",
    "записей = Sch1A; исключено": "recordings = Schedule 1 Part A; excluded",
    "; не классифицировано до экспорта Backstage:": "; not classified pending the Backstage export:",
    ", записи Sch1A, оба аккаунта Believe по этим ISRC)": ", Schedule 1 Part A recordings, both Believe accounts "
                                                         "for these ISRCs)",
    "% от поступлений аккаунта 1052428 с установленной долей за тот же период (US$":
        "% of account 1052428 receipts with an established share for the same period (US$",
    "); база — net, которую лейбл получил от Believe": "); basis: net receipts actually received by the label from Believe",
    "не входит в данные книги: выписка по п. 3.3.4 готовится отдельным файлом":
        "not part of this register: the clause 3.3.4 statement is a separate file",
    "Сверка: Duetti, Echo8, прочие исключения": "Reconciliation: Duetti, Echo8 and other exclusions",
    "Сверка: не-аудио продукты в периметре": "Reconciliation: non-audio products acquired",
    "поступлений клипов и рингтонов": "receipts from music videos and ringtones",
    "(i) Участия вне зарегистрированного сплита": "(i) Participations not reflected in the registered splits",
    "(ii) Прибавка доли лейбла от выкупов и уступок": "(ii) Additional interests under buy-out or assignment",
    ": лист «Sch3C (i) Участия»": ": sheet \"Sch3C (i) Participations\"",
    ": лист «Sch3C (ii) Выкупы»": ": sheet \"Sch3C (ii) Buy-outs\"",
    "реестр выкупов": "buy-out register",
    # Sch3D
    "Фондируемые Third-Party Payments": "Funded Third-Party Payments",
    "выплаты по листу «Sch3A Роялти» с поступлений после Completion":
        "payments under sheet \"Sch3A Royalty register\" from receipts on or after Completion",
    "Продолжающиеся обязанности": "Continuing performance obligations",
    "кредиты, одобрения и ограничения использования — «Sch2A Договоры»":
        "credit, approval and use restrictions: sheet \"Sch2A Agreements register\"",
    "Более широкие обязательства по требованию контрагента": "Broader undertaking required by a counterparty",
    "Дополнительные сервисные или минимальные платежи": "Additional service or minimum-payment obligation",
    "Административное вознаграждение продавца": "Seller's administration fee",
    "nil; покупатель оплачивает комиссии Sch 3 A": "nil; the Purchaser pays the costs in Schedule 3 Part A",
    "Closing administration file": "Closing administration file",
    "не входит в данные книги: готовится отдельным файлом": "not part of this register: a separate file",
    "Крупные авансовые платежи и предоплаченные лицензии": "Material upfront fees or prepaid continuing licences",
    # Sch4 / 5 / 6
    "не установлено": "not established", "в данных книги претензий нет": "no claim in the records",
    "нет источника": "no source",
    "договоры без подписи всех сторон по сертификату": "documents without an execution certificate of all parties",
    "лист «Договоры»": "Schedule 2 Part A register",
    "цедент не распознан": "transferor not recognised",
    "6.5.1, 6.6.1: записи без договора-основания": "6.5.1, 6.6.1: acquired recordings without an underlying agreement",
    "записей периметра, US$": "acquired recordings, US$",
    "6.6.1: соавторы только в чужом договоре или только в сплите":
        "6.6.1: contributors credited only in another party's agreement or only in the split",
    "групп": "groups", "6.9.1: ставки договора и сплита расходятся": "6.9.1: agreement rate differs from the split",
    "строк": "rows", "6.5.2: срок или территория не установлены": "6.5.2: term or territory not established",
    "записей": "recordings", "6.5.1: неподписанные документы": "6.5.1: documents not executed by all parties",
    "документов": "documents", "6.5.1: несколько редакций без выбранной": "6.5.1: several versions, none designated",
    "пар": "pairs",
    "6.3.3: записи в периметре, которые есть и в исключённых источниках":
        "6.3.3: acquired recordings that also appear in excluded sources",
    "6.10.1: расхождения каталога, денег и договоров":
        "6.10.1: discrepancies between the catalogue, the financial population and the contractual schedules",
    "сверки с Annex 14 и 0to8 Main": "reconciliations to Annex 14 and the label ledger",
    "Сводка, пробел 1": "Seller's working register, gap list 1", "Сводка, пробел 2": "gap list 2",
    "Сводка, пробел 4": "gap list 4", "Сводка, пробел 10": "gap list 10", "Сводка, пробел 9": "gap list 9",
    "Sch4B Документация": "Sch4B Documentation matters", "Sch2B Контрибьюторы": "Sch2B Contributor licences",
    "Сверка с Annex 14; Сверка с Main": "Seller's working register",
    "не из данных ERP: вносит владелец на Completion": "[●] to be completed by the Seller at Completion",
    # map
    "реестр приобретаемых записей: запись и версия, ISRC, категория права, доля, пакет Sch 2, срок, территория, объём":
        "acquired catalogue register: recording and version, ISRC, rights category, acquired share, Schedule 2 "
        "package, term, territory, scope",
    "собрано из данных; правовые поля автоматически, по записям не проверены":
        "compiled; rights fields extracted automatically, not verified record by record",
    "исключённые записи: Duetti, Echo8, отозванные, прочие": "excluded repertoire: Duetti, Echo8, withdrawn, other",
    "Sch1B Исключения; П8 Не классифицировано": "Sch1B Excluded register",
    "собрано из данных; записи без статуса Backstage ждут экспорта": "compiled",
    "ассеты по четырём категориям": "ancillary materials in four categories",
    "частично: реестра доставки ассетов нет": "partial: no asset-delivery register",
    "реестр договоров и пакеты артистов": "underlying agreement register and artist packages",
    "Sch2A Договоры; Sch2A Пакеты артистов": "Sch2A Agreements register; Sch2A Artist packages",
    "собрано из данных; способ передачи и распределение обязательств — решения по сделке":
        "compiled; transfer mechanism and allocated obligations are transaction decisions",
    "лицензии контрибьюторов и основание по каждому": "contributor licences and the basis of each",
    "собрано из данных и Annex 14 beta": "compiled", "собрано из данных": "compiled",
    "ограниченные лицензии и требуемые согласия": "restricted licences and Required Consents",
    "принятые ограничения": "accepted rights limitations",
    "кандидаты из текста договоров; покупателем не приняты": "candidates from the agreements; none accepted",
    "реестр роялти и участия вне сплита, комиссии каналов": "royalty register, participations and payment costs",
    "Sch3A Роялти; Sch3A Участия вне сплита; Sch3A Комиссии":
        "Sch3A Royalty register; Sch3A Participations; Sch3A Payment costs",
    "собрано из данных; сроки, налог и эскалаторы — из текста договоров":
        "compiled; deadlines, withholding and escalators from the agreements",
    "авансы и исторические суммы": "advances and historical amounts", "Sch3B Авансы": "Sch3B Advances",
    "справочная финансовая информация и две корректировки по ISRC":
        "reference financial information and the two ISRC-level adjustments",
    "Sch3C Финансы; Sch3C (i) Участия; Sch3C (ii) Выкупы":
        "Sch3C Reference financials; Sch3C (i) Participations; Sch3C (ii) Buy-outs",
    "принимаемые обязательства и администрирование": "assumed obligations and administration",
    "Sch3D Обязательства": "Sch3D Assumed obligations",
    "частично: closing administration file не из данных": "partial: closing administration file is separate",
    "известные претензии": "Known Claims", "Sch4A Претензии": "Sch4A Known claims",
    "из Annex 14 beta; из данных ERP не формируется": "compiled from the Seller's records",
    "вопросы документации": "documentation matters", "отложенные пункты": "Deferred Items",
    "Sch4C Отложенные": "Sch4C Deferred items",
    "легаси-уступки и их охват по записям": "legacy transfer instruments and their recording-level coverage",
    "Sch4D Цепочка; Sch4D Охват": "Sch4D Legacy instruments; Sch4D Coverage",
    "раскрытие": "disclosure", "Sch5 Раскрытие": "Sch5 Disclosure", "собрано из списков пробелов": "compiled",
    "банковские реквизиты продавца": "Seller bank account details", "Sch6 Банк": "Sch6 Bank details",
    "не из данных: вносит владелец": "to be completed by the Seller",
    "Sch1A Каталог": "Sch1A Catalogue register", "Sch1C Ассеты": "Sch1C Ancillary materials",
    "Sch2C Согласия": "Sch2C Required consents", "Sch2D Ограничения": "Sch2D Accepted limitations",
    "индекс архива документации": "archive index of the Documentation",
    "Договоры (колонки Файл и sha256 сверен)": "Sch2A Agreements register",
    "п. 4.2.3": "Clause 4.2.3",
    "решение владельца 09.11.2026": "decision of the Seller, 9 November 2026",
    "запись исключена из периметра по решению владельца 09.11.2026":
        "recording excluded by decision of the Seller, 9 November 2026",
    "(источник:": "(source:",
    "по договору, четыре канала роялти в schedule": "per the agreement: the four royalty channels in the schedule",
    "соавтор в таблице schedule этого договора": "co-author in the schedule table of this agreement",
    "ответы владельца 02.11.2026": "Seller's answers of 2 November 2026",
    "собрано из данных и Annex 14": "compiled", "из Annex 14; из данных ERP не формируется": "compiled from the Seller's records",
    "Одна строка — одна приобретаемая запись (периметр).": "One row per acquired recording.",
    "Фронтлайн Продукты": "not included in this register", "Фронтлайн": "Future Distribution Agreement",
    "счётчик продуктов по UPC для лимита сторонней дистрибуции":
        "product count by UPC for the third-party distribution allowance",
    "собрано из выгрузки Backstage": "kept in the Seller's working file",
    "лист «Договоры»": "Schedule 2 Part A register",
    "выплаты по листу «Sch3A Роялти» с поступлений после Completion":
        "payments under sheet \"Sch3A Royalty register\" from receipts on or after Completion",
}
SHORT = 4  # phrases this short are replaced only as whole words


def _ordered(extra: dict[str, str]) -> list[tuple[re.Pattern, str]]:
    table = dict(PHRASES)
    table.update(extra)
    out = []
    for ru in sorted(table, key=len, reverse=True):
        if not CYRILLIC.search(ru):
            continue
        body = re.escape(ru)
        # never inside a longer word
        if CYRILLIC.match(ru[0]):
            body = f"(?<![{LETTER}])" + body
        if CYRILLIC.match(ru[-1]):
            body = body + f"(?![{LETTER}])"
        out.append((re.compile(body), table[ru]))
    return out


TRANSLIT = dict(zip(
    "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ["A", "B", "V", "G", "D", "E", "E", "Zh", "Z", "I", "Y", "K", "L", "M", "N", "O", "P", "R", "S", "T", "U", "F",
     "Kh", "Ts", "Ch", "Sh", "Shch", "", "Y", "", "E", "Yu", "Ya",
     "a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f",
     "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"]))


def transliterate(text: str) -> str:
    return "".join(TRANSLIT.get(char, char) for char in text)


def english_half(text: str) -> str:
    """The longest run of the clause with no Cyrillic word: the English half of a bilingual clause."""
    words = text.split()
    best, run = [], []
    for word in words:
        if CYRILLIC.search(word):
            if len(run) > len(best):
                best = run
            run = []
        else:
            run.append(word)
    if len(run) > len(best):
        best = run
    found = " ".join(best).strip(" ;,")
    return found if len(found) >= 40 and re.search(r"[A-Za-z]{4}", found) else ""


class Translator:
    def __init__(self, extra: dict[str, str]):
        self.table = dict(PHRASES)
        self.table.update(extra)
        self.rules = _ordered(extra)
        self.used: dict[str, str] = {}
        self.untranslated: dict[str, int] = {}

    def _phrases(self, text: str) -> str:
        for pattern, english in self.rules:
            new = pattern.sub(english, text)
            if new != text:
                self.used[pattern.pattern] = english
                text = new
        text = re.sub(r"(\d+) по (\d+)", r"\1 across \2", text)
        # a decimal comma in a percent, written after the table so that the table still matches
        return re.sub(r"(\d),(\d+)\s?%", r"\1.\2%", text)

    @staticmethod
    def _leftover(text: str) -> bool:
        """Cyrillic outside file names: a segment naming a .pdf or .docx keeps its letters."""
        return any(CYRILLIC.search(part) for part in re.split(r";\s*|:\s+", text)
                   if ".pdf" not in part and ".docx" not in part)

    def __call__(self, value, identifier: bool = False, quote: bool = False, name: bool = False):
        if not isinstance(value, str):
            return value
        for latin, english in LATIN:
            value = value.replace(latin, english)
        if not CYRILLIC.search(value):
            return re.sub(r"(\d),(\d+)\s?%", r"\1.\2%", value).replace("«", "\"").replace("»", "\"")
        whole = self.table.get(value.strip())
        if identifier or name:
            # names, titles and file names stay as written; only a generated value is translated
            if whole is not None:
                self.used[value.strip()] = whole
                return whole
            if name and any(fragment in value for fragment in NAME_FRAGMENTS):
                text = value
                for fragment in NAME_FRAGMENTS:
                    if fragment in value and fragment in self.table:
                        text = text.replace(fragment, self.table[fragment])
                        self.used[fragment] = self.table[fragment]
                return text
            return value
        if quote:
            text = self._phrases(value)
            def clause(match):
                body = match.group(1)
                if not CYRILLIC.search(body):
                    return "«" + body + "»"
                half = english_half(body)
                return "«…" + half + "…»" if half else "«see the agreement»"
            text = re.sub(r"«([^»]*)»", clause, text)
            if self._leftover(text):
                half = english_half(text)
                text = "…" + half + "…" if half else "see the agreement"
            return text.replace("«", "\"").replace("»", "\"")
        text = self._phrases(value)
        text = re.sub(r"«([^»]*)»", lambda m: "«" + (m.group(1) if not CYRILLIC.search(m.group(1))
                                                      else (("…" + english_half(m.group(1)) + "…")
                                                            if english_half(m.group(1)) else "see the agreement"))
                      + "»", text)
        # what is left in Cyrillic must be a file name; anything else is untranslated
        if self._leftover(text):
            self.untranslated[text[:200]] = self.untranslated.get(text[:200], 0) + 1
        return text.replace("«", "\"").replace("»", "\"")


def header(name: str) -> str:
    return HEADERS.get(name, name)
