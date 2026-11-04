window.CASES = [
  {
    "id": "G01",
    "title": "Одна строка 50",
    "level": "простой",
    "source": "docs/agents/12_golden_cases.md G01",
    "description": "Сплит с одной строкой A 50 %. A получает половину, остаток доли лейбла — нам.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G04",
    "title": "Ремиксер с верха",
    "level": "простой",
    "source": "docs/agents/12_golden_cases.md G04",
    "description": "Участие R 15 % (net, top) берётся до сплита; строки A и B по 25 % считаются от scaledNet 85. Ждём R 15, A 21.25, B 21.25, наши 42.5.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "85.000000000000",
            "out": "85.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "42.500000000000",
            "out": "42.500000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": []
          },
          {
            "id": "artist:R",
            "label": "R",
            "column": 4,
            "in": "15.000000000000",
            "out": "15.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "42.500000000000",
            "out": "42.500000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "net",
            "to": "artist:R",
            "amount": "15.000000000000",
            "kind": "top",
            "ruleId": "part-0-R",
            "documentId": "ok",
            "percent": "15",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "21.250000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "21.250000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "42.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "42.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "85.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "85.000000000000",
            "labelShare": "85.000000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              }
            ]
          },
          {
            "layer": "split",
            "scaledNet": "85.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "21.250000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "85.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "21.250000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "85.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "21.250000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-R",
        "summary": "участие R 15 % (net, top), документ ok",
        "fields": {
          "id": "part-0-R",
          "isrc": "QZTST2600001",
          "artist_id": "R",
          "percent": "15",
          "base": "net",
          "funded_from": "top",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "off-the-top"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G05a",
    "title": "Саблейбл NoGhost: половина остатка",
    "level": "простой",
    "source": "docs/agents/12_golden_cases.md G05a",
    "description": "Строка лейбла NoGhost Records — саблейбл 0to8 с правилом 50 % остатка доли лейбла псевдониму NG (документ утверждён). Строка A 50: NG 25 (B), наши 25.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|NoGhost Records|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "NoGhost Records",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "artist:NG",
            "label": "NG",
            "column": 4,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:NG",
            "amount": "25.000000000000",
            "kind": "sublabel",
            "ruleId": "rule-ng",
            "documentId": "ok",
            "percent": "50",
            "base": "50.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "25.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "25.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "25.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "25.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "25.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «NoGhost Records», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "NoGhost Records",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "LNG",
        "summary": "саблейбл NoGhost Records (под L0)",
        "fields": {
          "id": "LNG",
          "name": "NoGhost Records",
          "kind": "sublabel",
          "own_label_id": "L0",
          "aliases": "NoGhost Records"
        },
        "node": "label-of-record"
      },
      {
        "kind": "label_rule",
        "id": "rule-ng",
        "summary": "правило саблейбла 50 % остатка доли → NG, документ ok",
        "fields": {
          "id": "rule-ng",
          "label_id": "LNG",
          "percent": "50",
          "recipient_artist_id": "NG",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "sublabel"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G12",
    "title": "Доля из строки артиста (artist_share)",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G12",
    "description": "Битмейкер E получает 10 % строки A (bucket, artist_share из A). Строка A 50: E 5, A 45, наши 50.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "45.000000000000",
            "out": "45.000000000000",
            "notes": []
          },
          {
            "id": "artist:E",
            "label": "E",
            "column": 4,
            "in": "5.000000000000",
            "out": "5.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:E",
            "amount": "5.000000000000",
            "kind": "artist_share",
            "ruleId": "part-0-E",
            "documentId": "ok",
            "percent": "10",
            "base": "50.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "45.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "45.000000000000"
              },
              {
                "artistId": "E",
                "kind": "artist_share",
                "amount": "5.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "45.000000000000"
              },
              {
                "artistId": "E",
                "kind": "artist_share",
                "amount": "5.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-E",
        "summary": "участие E 10 % (bucket, artist_share из A), документ ok",
        "fields": {
          "id": "part-0-E",
          "isrc": "QZTST2600001",
          "artist_id": "E",
          "percent": "10",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "A",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G03b",
    "title": "Пул: два участника по 13 % net",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G03b",
    "description": "Строки A 25, B 25; участия M1 и M2 по 13 % (net, artist_pool). Цели 26 берутся из строк пропорционально (по 13), A и B по 12. Узел pool без остатка.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "pool",
            "label": "пул",
            "column": 2,
            "in": "26.000000000000",
            "out": "26.000000000000",
            "notes": []
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "12.000000000000",
            "out": "12.000000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "12.000000000000",
            "out": "12.000000000000",
            "notes": []
          },
          {
            "id": "artist:M1",
            "label": "M1",
            "column": 4,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "artist:M2",
            "label": "M2",
            "column": 4,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "pool",
            "amount": "13.000000000000",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "pool",
            "amount": "13.000000000000",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "pool",
            "to": "artist:M1",
            "amount": "13.000000000000",
            "kind": "artist_pool",
            "ruleId": "part-0-M1",
            "documentId": "ok",
            "percent": "13",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "pool",
            "to": "artist:M2",
            "amount": "13.000000000000",
            "kind": "artist_pool",
            "ruleId": "part-1-M2",
            "documentId": "ok",
            "percent": "13",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "12.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "12.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "25.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "12.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "12.000000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "12.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "12.000000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-M1",
        "summary": "участие M1 13 % (net, artist_pool), документ ok",
        "fields": {
          "id": "part-0-M1",
          "isrc": "QZTST2600001",
          "artist_id": "M1",
          "percent": "13",
          "base": "net",
          "funded_from": "artist_pool",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:pool"
      },
      {
        "kind": "participation",
        "id": "part-1-M2",
        "summary": "участие M2 13 % (net, artist_pool), документ ok",
        "fields": {
          "id": "part-1-M2",
          "isrc": "QZTST2600001",
          "artist_id": "M2",
          "percent": "13",
          "base": "net",
          "funded_from": "artist_pool",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:pool"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G11",
    "title": "A&R из доли лейбла (bucket)",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G11",
    "description": "Строка A 50; участие P 15 % (bucket, label_share) — от доли лейбла 50: P 7.5, наши 42.5.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "artist:P",
            "label": "P",
            "column": 4,
            "in": "7.500000000000",
            "out": "7.500000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "42.500000000000",
            "out": "42.500000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:P",
            "amount": "7.500000000000",
            "kind": "label_share",
            "ruleId": "part-0-P",
            "documentId": "ok",
            "percent": "15",
            "base": "50.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "42.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "7.500000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "7.500000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-P",
        "summary": "участие P 15 % (bucket, label_share), документ ok",
        "fields": {
          "id": "part-0-P",
          "isrc": "QZTST2600001",
          "artist_id": "P",
          "percent": "15",
          "base": "bucket",
          "funded_from": "label_share",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:label_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G36",
    "title": "Сеттлмент 15 % net из доли лейбла",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G36",
    "description": "Строки A 25, B 25; участие S 15 % (net, label_share): процент от net, но деньги берутся из доли лейбла 50. S 15, наши 35.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": []
          },
          {
            "id": "artist:S",
            "label": "S",
            "column": 4,
            "in": "15.000000000000",
            "out": "15.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "35.000000000000",
            "out": "35.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:S",
            "amount": "15.000000000000",
            "kind": "label_share",
            "ruleId": "part-0-S",
            "documentId": "ok",
            "percent": "15",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "25.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "25.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "35.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "25.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "35.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "S",
                "kind": "label_share",
                "amount": "15.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "35.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "S",
                "kind": "label_share",
                "amount": "15.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-S",
        "summary": "участие S 15 % (net, label_share), документ ok",
        "fields": {
          "id": "part-0-S",
          "isrc": "QZTST2600001",
          "artist_id": "S",
          "percent": "15",
          "base": "net",
          "funded_from": "label_share",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:label_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G08c",
    "title": "Строка лейбла не распознана",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G08c",
    "description": "Строка лейбла «Mystery Records» нет в словаре. Артист A по своей строке получает 50, остаток доли лейбла 50 ждёт в C label_unmapped.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Mystery Records|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Mystery Records",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "c:label_unmapped"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "c:label_unmapped",
            "label": "ждёт: label_unmapped",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "c:label_unmapped",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "C",
            "reason": "label_unmapped",
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Mystery Records», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Mystery Records",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "unmapped:Mystery Records",
        "summary": "строка лейбла «Mystery Records» не найдена в словаре алиасов",
        "fields": {
          "label_name": "Mystery Records",
          "label_id": null
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G21",
    "title": "Нет сплита, саблейбл (R1)",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G21",
    "description": "У ISRC нет сплита, строка лейбла NoGhost Records. Доля лейбла — весь net 100; NG 50 по правилу саблейбла, но это допущение R1 (C assumption); наши 50.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|NoGhost Records|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "NoGhost Records",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "no_split",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:NG",
            "label": "NG",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "labelShare",
            "to": "artist:NG",
            "amount": "50.000000000000",
            "kind": "sublabel",
            "ruleId": "rule-ng",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": "C",
            "reason": "assumption",
            "assumption": "r1"
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "50.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «NoGhost Records», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "NoGhost Records",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "LNG",
        "summary": "саблейбл NoGhost Records (под L0)",
        "fields": {
          "id": "LNG",
          "name": "NoGhost Records",
          "kind": "sublabel",
          "own_label_id": "L0",
          "aliases": "NoGhost Records"
        },
        "node": "label-of-record"
      },
      {
        "kind": "label_rule",
        "id": "rule-ng",
        "summary": "правило саблейбла 50 % остатка доли → NG, документ ok",
        "fields": {
          "id": "rule-ng",
          "label_id": "LNG",
          "percent": "50",
          "recipient_artist_id": "NG",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "sublabel"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G22",
    "title": "Пул меньше цели: недостача",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G22",
    "description": "Строка A 10; участие P 20 % (net, artist_pool): цель 20, а в строках только 10. P берёт весь пул, строка A уходит в 0, недостача 10 — подпись у узла pool.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "pool",
            "label": "пул",
            "column": 2,
            "in": "10.000000000000",
            "out": "10.000000000000",
            "notes": [
              {
                "ruleId": "part-0-P",
                "missing": "10.000000000000",
                "why": "bucket_short"
              }
            ]
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "10.000000000000",
            "out": "10.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "90.000000000000",
            "out": "90.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "0.000000000000",
            "out": "0.000000000000",
            "notes": []
          },
          {
            "id": "artist:P",
            "label": "P",
            "column": 4,
            "in": "10.000000000000",
            "out": "10.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "90.000000000000",
            "out": "90.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "10.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "10",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "pool",
            "amount": "10.000000000000",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "pool",
            "to": "artist:P",
            "amount": "10.000000000000",
            "kind": "artist_pool",
            "ruleId": "part-0-P",
            "documentId": "ok",
            "percent": "20",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "0.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "90.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "90.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "90.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "10.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "90.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "0.000000000000"
              },
              {
                "artistId": "P",
                "kind": "artist_pool",
                "amount": "10.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "90.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "0.000000000000"
              },
              {
                "artistId": "P",
                "kind": "artist_pool",
                "amount": "10.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 10 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "10",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-P",
        "summary": "участие P 20 % (net, artist_pool), документ ok",
        "fields": {
          "id": "part-0-P",
          "isrc": "QZTST2600001",
          "artist_id": "P",
          "percent": "20",
          "base": "net",
          "funded_from": "artist_pool",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:pool"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G15",
    "title": "Отрицательный юнит −100",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G15",
    "description": "Как G04 плюс саблейбл NoGhost, но net −100 (возврат). Все рёбра со знаком юнита: R −15, A −21.25, B −21.25, NG −21.25, наши −21.25.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|NoGhost Records|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "NoGhost Records",
          "account": "1052428",
          "net": "-100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "-100.000000000000",
            "out": "-100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "-85.000000000000",
            "out": "-85.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "-42.500000000000",
            "out": "-42.500000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": []
          },
          {
            "id": "artist:NG",
            "label": "NG",
            "column": 4,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": []
          },
          {
            "id": "artist:R",
            "label": "R",
            "column": 4,
            "in": "-15.000000000000",
            "out": "-15.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "-21.250000000000",
            "out": "-21.250000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "net",
            "to": "artist:R",
            "amount": "-15.000000000000",
            "kind": "top",
            "ruleId": "part-0-R",
            "documentId": "ok",
            "percent": "15",
            "base": "-100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "-21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "-85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "-21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "-85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:NG",
            "amount": "-21.250000000000",
            "kind": "sublabel",
            "ruleId": "rule-ng",
            "documentId": "ok",
            "percent": "50",
            "base": "-42.500000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "-21.250000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "-21.250000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "-42.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "-21.250000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "-85.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "-100.000000000000",
            "labelShare": "-100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "-100.000000000000",
            "labelShare": "-100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "-85.000000000000",
            "labelShare": "-85.000000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "-15.000000000000"
              }
            ]
          },
          {
            "layer": "split",
            "scaledNet": "-85.000000000000",
            "labelShare": "-42.500000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "-15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "-21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "-21.250000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "-85.000000000000",
            "labelShare": "-21.250000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "-15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "-21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "-21.250000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "-21.250000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "-85.000000000000",
            "labelShare": "-21.250000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "-15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "-21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "-21.250000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "-21.250000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «NoGhost Records», net -100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "NoGhost Records",
          "net": "-100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "LNG",
        "summary": "саблейбл NoGhost Records (под L0)",
        "fields": {
          "id": "LNG",
          "name": "NoGhost Records",
          "kind": "sublabel",
          "own_label_id": "L0",
          "aliases": "NoGhost Records"
        },
        "node": "label-of-record"
      },
      {
        "kind": "label_rule",
        "id": "rule-ng",
        "summary": "правило саблейбла 50 % остатка доли → NG, документ ok",
        "fields": {
          "id": "rule-ng",
          "label_id": "LNG",
          "percent": "50",
          "recipient_artist_id": "NG",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "sublabel"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-R",
        "summary": "участие R 15 % (net, top), документ ok",
        "fields": {
          "id": "part-0-R",
          "isrc": "QZTST2600001",
          "artist_id": "R",
          "percent": "15",
          "base": "net",
          "funded_from": "top",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "off-the-top"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G30",
    "title": "Периметр: неизвестная пара",
    "level": "средний",
    "source": "docs/agents/12_golden_cases.md G30",
    "description": "Пара ISRC|UPC не известна модулю 1: юнит net 7 целиком ждёт в C unknown_pair, остальные слои не работают. Одно ребро.",
    "units": [
      {
        "unitKey": "999|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "999",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "7.000000000000"
        },
        "status": "unknown_pair",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "7.000000000000",
            "out": "7.000000000000",
            "notes": []
          },
          {
            "id": "c:unknown_pair",
            "label": "ждёт: unknown_pair",
            "column": 4,
            "in": "7.000000000000",
            "out": "7.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "net",
            "to": "c:unknown_pair",
            "amount": "7.000000000000",
            "kind": "perimeter",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "C",
            "reason": "unknown_pair",
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "7.000000000000",
            "labelShare": "7.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "7.000000000000",
            "labelShare": "7.000000000000",
            "rows": []
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|999|2026-03",
        "summary": "юнит 999, 2026-03, «Test Label», net 7",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "999",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "7"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G18b",
    "title": "Всё вместе на одном юните",
    "level": "сложный",
    "source": "docs/agents/12_golden_cases.md G18b",
    "description": "NoGhost; строки A 25, B 25; R 15 (top), M 13 (pool), P 10 (bucket, label_share), E 10 из A (artist_share после пула). P и NG — допущение Q11 (C assumption).",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|NoGhost Records|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "NoGhost Records",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "85.000000000000",
            "out": "85.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "pool",
            "label": "пул",
            "column": 2,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "21.250000000000",
            "out": "21.250000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "42.500000000000",
            "out": "42.500000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "13.275000000000",
            "out": "13.275000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "14.750000000000",
            "out": "14.750000000000",
            "notes": []
          },
          {
            "id": "artist:E",
            "label": "E",
            "column": 4,
            "in": "1.475000000000",
            "out": "1.475000000000",
            "notes": []
          },
          {
            "id": "artist:M",
            "label": "M",
            "column": 4,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "artist:NG",
            "label": "NG",
            "column": 4,
            "in": "19.125000000000",
            "out": "19.125000000000",
            "notes": []
          },
          {
            "id": "artist:P",
            "label": "P",
            "column": 4,
            "in": "4.250000000000",
            "out": "4.250000000000",
            "notes": []
          },
          {
            "id": "artist:R",
            "label": "R",
            "column": 4,
            "in": "15.000000000000",
            "out": "15.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "19.125000000000",
            "out": "19.125000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "net",
            "to": "artist:R",
            "amount": "15.000000000000",
            "kind": "top",
            "ruleId": "part-0-R",
            "documentId": "ok",
            "percent": "15",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "21.250000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "85.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "pool",
            "amount": "6.500000000000",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "pool",
            "amount": "6.500000000000",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "pool",
            "to": "artist:M",
            "amount": "13.000000000000",
            "kind": "artist_pool",
            "ruleId": "part-1-M",
            "documentId": "ok",
            "percent": "13",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:E",
            "amount": "1.475000000000",
            "kind": "artist_share",
            "ruleId": "part-3-E",
            "documentId": "ok",
            "percent": "10",
            "base": "14.750000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:P",
            "amount": "4.250000000000",
            "kind": "label_share",
            "ruleId": "part-2-P",
            "documentId": "ok",
            "percent": "10",
            "base": "42.500000000000",
            "category": "C",
            "reason": "assumption",
            "assumption": "q11"
          },
          {
            "from": "labelShare",
            "to": "artist:NG",
            "amount": "19.125000000000",
            "kind": "sublabel",
            "ruleId": "rule-ng",
            "documentId": "ok",
            "percent": "50",
            "base": "38.250000000000",
            "category": "C",
            "reason": "assumption",
            "assumption": "q11"
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "13.275000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "14.750000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "42.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "19.125000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "85.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "85.000000000000",
            "labelShare": "85.000000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              }
            ]
          },
          {
            "layer": "split",
            "scaledNet": "85.000000000000",
            "labelShare": "42.500000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "21.250000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "21.250000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "85.000000000000",
            "labelShare": "19.125000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "13.275000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "14.750000000000"
              },
              {
                "artistId": "M",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              },
              {
                "artistId": "E",
                "kind": "artist_share",
                "amount": "1.475000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "4.250000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "19.125000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "85.000000000000",
            "labelShare": "19.125000000000",
            "rows": [
              {
                "artistId": "R",
                "kind": "top",
                "amount": "15.000000000000"
              },
              {
                "artistId": "A",
                "kind": "row",
                "amount": "13.275000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "14.750000000000"
              },
              {
                "artistId": "M",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              },
              {
                "artistId": "E",
                "kind": "artist_share",
                "amount": "1.475000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "4.250000000000"
              },
              {
                "artistId": "NG",
                "kind": "sublabel",
                "amount": "19.125000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «NoGhost Records», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "NoGhost Records",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "LNG",
        "summary": "саблейбл NoGhost Records (под L0)",
        "fields": {
          "id": "LNG",
          "name": "NoGhost Records",
          "kind": "sublabel",
          "own_label_id": "L0",
          "aliases": "NoGhost Records"
        },
        "node": "label-of-record"
      },
      {
        "kind": "label_rule",
        "id": "rule-ng",
        "summary": "правило саблейбла 50 % остатка доли → NG, документ ok",
        "fields": {
          "id": "rule-ng",
          "label_id": "LNG",
          "percent": "50",
          "recipient_artist_id": "NG",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "sublabel"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-R",
        "summary": "участие R 15 % (net, top), документ ok",
        "fields": {
          "id": "part-0-R",
          "isrc": "QZTST2600001",
          "artist_id": "R",
          "percent": "15",
          "base": "net",
          "funded_from": "top",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "off-the-top"
      },
      {
        "kind": "participation",
        "id": "part-1-M",
        "summary": "участие M 13 % (net, artist_pool), документ ok",
        "fields": {
          "id": "part-1-M",
          "isrc": "QZTST2600001",
          "artist_id": "M",
          "percent": "13",
          "base": "net",
          "funded_from": "artist_pool",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:pool"
      },
      {
        "kind": "participation",
        "id": "part-2-P",
        "summary": "участие P 10 % (bucket, label_share), документ ok",
        "fields": {
          "id": "part-2-P",
          "isrc": "QZTST2600001",
          "artist_id": "P",
          "percent": "10",
          "base": "bucket",
          "funded_from": "label_share",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:label_share"
      },
      {
        "kind": "participation",
        "id": "part-3-E",
        "summary": "участие E 10 % (bucket, artist_share из A), документ ok",
        "fields": {
          "id": "part-3-E",
          "isrc": "QZTST2600001",
          "artist_id": "E",
          "percent": "10",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "A",
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G34",
    "title": "Пико-остатки пула",
    "level": "сложный",
    "source": "docs/agents/12_golden_cases.md G34",
    "description": "Строки A, B, C по 16.6; M 13 % (net, artist_pool). Пропорция 13 × 16.6 / 49.8 не конечна: квантуется до 12 знаков, остаток пико — строке с наибольшей суммой (при равенстве первой, A).",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "pool",
            "label": "пул",
            "column": 2,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "16.600000000000",
            "out": "16.600000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "16.600000000000",
            "out": "16.600000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "row:C",
            "label": "строка C",
            "column": 2,
            "in": "16.600000000000",
            "out": "16.600000000000",
            "notes": [],
            "remainderTo": "artist:C"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.200000000000",
            "out": "50.200000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "12.266666666666",
            "out": "12.266666666666",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "12.266666666667",
            "out": "12.266666666667",
            "notes": []
          },
          {
            "id": "artist:C",
            "label": "C",
            "column": 4,
            "in": "12.266666666667",
            "out": "12.266666666667",
            "notes": []
          },
          {
            "id": "artist:M",
            "label": "M",
            "column": 4,
            "in": "13.000000000000",
            "out": "13.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.200000000000",
            "out": "50.200000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "16.600000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "16.6",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "16.600000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "16.6",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:C",
            "amount": "16.600000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "16.6",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "pool",
            "amount": "4.333333333334",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "pool",
            "amount": "4.333333333333",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:C",
            "to": "pool",
            "amount": "4.333333333333",
            "kind": "draw",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "pool",
            "to": "artist:M",
            "amount": "13.000000000000",
            "kind": "artist_pool",
            "ruleId": "part-0-M",
            "documentId": "ok",
            "percent": "13",
            "base": "100.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "12.266666666666",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "12.266666666667",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:C",
            "to": "artist:C",
            "amount": "12.266666666667",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.200000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.200000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.200000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "16.600000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "16.600000000000"
              },
              {
                "artistId": "C",
                "kind": "row",
                "amount": "16.600000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.200000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "12.266666666666"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "12.266666666667"
              },
              {
                "artistId": "C",
                "kind": "row",
                "amount": "12.266666666667"
              },
              {
                "artistId": "M",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.200000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "12.266666666666"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "12.266666666667"
              },
              {
                "artistId": "C",
                "kind": "row",
                "amount": "12.266666666667"
              },
              {
                "artistId": "M",
                "kind": "artist_pool",
                "amount": "13.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 16.6 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "16.6",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 16.6 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "16.6",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:C",
        "summary": "строка C 16.6 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "C",
          "percent": "16.6",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-M",
        "summary": "участие M 13 % (net, artist_pool), документ ok",
        "fields": {
          "id": "part-0-M",
          "isrc": "QZTST2600001",
          "artist_id": "M",
          "percent": "13",
          "base": "net",
          "funded_from": "artist_pool",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:pool"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G46",
    "title": "По два artist_share на двух строках",
    "level": "сложный",
    "source": "docs/agents/12_golden_cases.md G46",
    "description": "Карв Main «16.66 % (8.33/8.33)»: M1 и M2 каждый берут 16.66 % из строки A и 16.66 % из строки B (bucket, artist_share). Каждая строка 25 теряет 2 × 4.165, остаётся 16.67.",
    "units": [
      {
        "unitKey": "1234567890123|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "row:B",
            "label": "строка B",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:B"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "16.670000000000",
            "out": "16.670000000000",
            "notes": []
          },
          {
            "id": "artist:B",
            "label": "B",
            "column": 4,
            "in": "16.670000000000",
            "out": "16.670000000000",
            "notes": []
          },
          {
            "id": "artist:M1",
            "label": "M1",
            "column": 4,
            "in": "8.330000000000",
            "out": "8.330000000000",
            "notes": []
          },
          {
            "id": "artist:M2",
            "label": "M2",
            "column": 4,
            "in": "8.330000000000",
            "out": "8.330000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "row:B",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "25",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:M1",
            "amount": "4.165000000000",
            "kind": "artist_share",
            "ruleId": "part-0-M1",
            "documentId": "ok",
            "percent": "16.66",
            "base": "25.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:M1",
            "amount": "4.165000000000",
            "kind": "artist_share",
            "ruleId": "part-1-M1",
            "documentId": "ok",
            "percent": "16.66",
            "base": "25.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:M2",
            "amount": "4.165000000000",
            "kind": "artist_share",
            "ruleId": "part-2-M2",
            "documentId": "ok",
            "percent": "16.66",
            "base": "25.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:M2",
            "amount": "4.165000000000",
            "kind": "artist_share",
            "ruleId": "part-3-M2",
            "documentId": "ok",
            "percent": "16.66",
            "base": "25.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "16.670000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:B",
            "to": "artist:B",
            "amount": "16.670000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "25.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "16.670000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "16.670000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_share",
                "amount": "4.165000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "16.670000000000"
              },
              {
                "artistId": "B",
                "kind": "row",
                "amount": "16.670000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M1",
                "kind": "artist_share",
                "amount": "4.165000000000"
              },
              {
                "artistId": "M2",
                "kind": "artist_share",
                "amount": "4.165000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1234567890123|2026-03",
        "summary": "юнит 1234567890123, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1234567890123",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:B",
        "summary": "строка B 25 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "B",
          "percent": "25",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-M1",
        "summary": "участие M1 16.66 % (bucket, artist_share из A), документ ok",
        "fields": {
          "id": "part-0-M1",
          "isrc": "QZTST2600001",
          "artist_id": "M1",
          "percent": "16.66",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "A",
          "document_id": "ok",
          "valid_from": "2026-01-01",
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "participation",
        "id": "part-1-M1",
        "summary": "участие M1 16.66 % (bucket, artist_share из B), документ ok",
        "fields": {
          "id": "part-1-M1",
          "isrc": "QZTST2600001",
          "artist_id": "M1",
          "percent": "16.66",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "B",
          "document_id": "ok",
          "valid_from": "2026-01-01",
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "participation",
        "id": "part-2-M2",
        "summary": "участие M2 16.66 % (bucket, artist_share из A), документ ok",
        "fields": {
          "id": "part-2-M2",
          "isrc": "QZTST2600001",
          "artist_id": "M2",
          "percent": "16.66",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "A",
          "document_id": "ok",
          "valid_from": "2026-01-01",
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "participation",
        "id": "part-3-M2",
        "summary": "участие M2 16.66 % (bucket, artist_share из B), документ ok",
        "fields": {
          "id": "part-3-M2",
          "isrc": "QZTST2600001",
          "artist_id": "M2",
          "percent": "16.66",
          "base": "bucket",
          "funded_from": "artist_share",
          "from_artist_id": "B",
          "document_id": "ok",
          "valid_from": "2026-01-01",
          "valid_to": null
        },
        "node": "carve:artist_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  },
  {
    "id": "G24",
    "title": "Трек-месяц из двух юнитов",
    "level": "сложный",
    "source": "docs/agents/12_golden_cases.md G24",
    "description": "Один ISRC с двумя UPC: юниты net 100 и net 50. Строка A 50, P 10 % (bucket, label_share). Корзины юнитов не склеиваются; на трек-месяце A 75, P 7.5, наши 67.5.",
    "units": [
      {
        "unitKey": "1111111111111|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "1111111111111",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "100.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "100.000000000000",
            "out": "100.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": []
          },
          {
            "id": "artist:P",
            "label": "P",
            "column": 4,
            "in": "5.000000000000",
            "out": "5.000000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "45.000000000000",
            "out": "45.000000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "50.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "100.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:P",
            "amount": "5.000000000000",
            "kind": "label_share",
            "ruleId": "part-0-P",
            "documentId": "ok",
            "percent": "10",
            "base": "50.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "45.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "100.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "100.000000000000",
            "labelShare": "100.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "100.000000000000",
            "labelShare": "50.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "100.000000000000",
            "labelShare": "45.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "5.000000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "100.000000000000",
            "labelShare": "45.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "50.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "5.000000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      },
      {
        "unitKey": "2222222222222|2026-03|Test Label|1052428",
        "unit": {
          "isrc": "QZTST2600001",
          "upc": "2222222222222",
          "reportingMonth": "2026-03",
          "salesMonth": "2026-03",
          "labelName": "Test Label",
          "account": "1052428",
          "net": "50.000000000000"
        },
        "status": "allocated",
        "scheme": "master/standard",
        "nodes": [
          {
            "id": "net",
            "label": "net",
            "column": 0,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "scaledNet"
          },
          {
            "id": "scaledNet",
            "label": "после top",
            "column": 1,
            "in": "50.000000000000",
            "out": "50.000000000000",
            "notes": [],
            "remainderTo": "labelShare"
          },
          {
            "id": "row:A",
            "label": "строка A",
            "column": 2,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "artist:A"
          },
          {
            "id": "labelShare",
            "label": "доля лейбла",
            "column": 3,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": [],
            "remainderTo": "ours"
          },
          {
            "id": "artist:A",
            "label": "A",
            "column": 4,
            "in": "25.000000000000",
            "out": "25.000000000000",
            "notes": []
          },
          {
            "id": "artist:P",
            "label": "P",
            "column": 4,
            "in": "2.500000000000",
            "out": "2.500000000000",
            "notes": []
          },
          {
            "id": "ours",
            "label": "наша доля",
            "column": 4,
            "in": "22.500000000000",
            "out": "22.500000000000",
            "notes": []
          }
        ],
        "edges": [
          {
            "from": "scaledNet",
            "to": "row:A",
            "amount": "25.000000000000",
            "kind": "row",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": "50",
            "base": "50.000000000000",
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "artist:P",
            "amount": "2.500000000000",
            "kind": "label_share",
            "ruleId": "part-0-P",
            "documentId": "ok",
            "percent": "10",
            "base": "25.000000000000",
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "row:A",
            "to": "artist:A",
            "amount": "25.000000000000",
            "kind": "remainder",
            "ruleId": "split-QZTST2600001-start",
            "documentId": "ok",
            "percent": null,
            "base": null,
            "category": "B",
            "reason": null,
            "assumption": null
          },
          {
            "from": "scaledNet",
            "to": "labelShare",
            "amount": "25.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          },
          {
            "from": "labelShare",
            "to": "ours",
            "amount": "22.500000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": "ours",
            "reason": null,
            "assumption": null
          },
          {
            "from": "net",
            "to": "scaledNet",
            "amount": "50.000000000000",
            "kind": "remainder",
            "ruleId": null,
            "documentId": null,
            "percent": null,
            "base": null,
            "category": null,
            "reason": null,
            "assumption": null
          }
        ],
        "trace": [
          {
            "layer": "label-of-record",
            "scaledNet": "50.000000000000",
            "labelShare": "50.000000000000",
            "rows": []
          },
          {
            "layer": "perimeter",
            "scaledNet": "50.000000000000",
            "labelShare": "50.000000000000",
            "rows": []
          },
          {
            "layer": "off-the-top",
            "scaledNet": "50.000000000000",
            "labelShare": "50.000000000000",
            "rows": []
          },
          {
            "layer": "split",
            "scaledNet": "50.000000000000",
            "labelShare": "25.000000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              }
            ]
          },
          {
            "layer": "carve",
            "scaledNet": "50.000000000000",
            "labelShare": "22.500000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "2.500000000000"
              }
            ]
          },
          {
            "layer": "categorise",
            "scaledNet": "50.000000000000",
            "labelShare": "22.500000000000",
            "rows": [
              {
                "artistId": "A",
                "kind": "row",
                "amount": "25.000000000000"
              },
              {
                "artistId": "P",
                "kind": "label_share",
                "amount": "2.500000000000"
              }
            ]
          }
        ],
        "checks": {
          "nodeBalance": true,
          "sinksEqualNet": true,
          "edgesEqualAllocations": true,
          "signOk": true
        }
      }
    ],
    "inputs": [
      {
        "kind": "unit",
        "id": "QZTST2600001|1111111111111|2026-03",
        "summary": "юнит 1111111111111, 2026-03, «Test Label», net 100",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "1111111111111",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "100"
        },
        "node": "net"
      },
      {
        "kind": "unit",
        "id": "QZTST2600001|2222222222222|2026-03",
        "summary": "юнит 2222222222222, 2026-03, «Test Label», net 50",
        "fields": {
          "account": "1052428",
          "isrc": "QZTST2600001",
          "upc": "2222222222222",
          "reporting_month": "2026-03",
          "sales_month": "2026-03",
          "label_name": "Test Label",
          "net": "50"
        },
        "node": "net"
      },
      {
        "kind": "label",
        "id": "L0",
        "summary": "наш лейбл 0to8",
        "fields": {
          "id": "L0",
          "name": "0to8",
          "kind": "own",
          "own_label_id": null,
          "aliases": "Test Label, 0to8, Ahh Music"
        },
        "node": "label-of-record"
      },
      {
        "kind": "split_row",
        "id": "split-QZTST2600001-start:A",
        "summary": "строка A 50 % от scaledNet, документ ok",
        "fields": {
          "split_id": "split-QZTST2600001-start",
          "isrc": "QZTST2600001",
          "artist_id": "A",
          "percent": "50",
          "document_id": null,
          "split_document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "split"
      },
      {
        "kind": "participation",
        "id": "part-0-P",
        "summary": "участие P 10 % (bucket, label_share), документ ok",
        "fields": {
          "id": "part-0-P",
          "isrc": "QZTST2600001",
          "artist_id": "P",
          "percent": "10",
          "base": "bucket",
          "funded_from": "label_share",
          "from_artist_id": null,
          "document_id": "ok",
          "valid_from": null,
          "valid_to": null
        },
        "node": "carve:label_share"
      },
      {
        "kind": "document",
        "id": "ok",
        "summary": "документ ok: appendix, approved",
        "fields": {
          "id": "ok",
          "kind": "appendix",
          "status": "approved"
        },
        "node": "categorise"
      }
    ]
  }
];
