# Innovatrics – 2. kolo (návrh systému)

Tento priečinok zhŕňa druhé kolo pohovoru: návrh notifikačného systému.

| Súbor | Na čo slúži |
|---|---|
| [`README.md`](README.md) | tento prehľad |
| [`zadanie.drawio`](zadanie.drawio) | pôvodné zadanie (diagram) |
| [`inovatrics-navrh-vysledok.drawio`](inovatrics-navrh-vysledok.drawio) | moje riešenie z pohovoru |
| [`inovatrics-navrh-vysledok-review.md`](inovatrics-navrh-vysledok-review.md) | **review – čo v mojom riešení chýba** v porovnaní s návrhmi nižšie |
| [`notification-navrh-claude.md`](notification-navrh-claude.md) + [`.drawio`](notification-navrh-claude.drawio) | návrh po krokoch s RabbitMQ |
| [`notification-navrh-kafka.md`](notification-navrh-kafka.md) + [`.drawio`](notification-navrh-kafka.drawio) | ten istý návrh s Kafkou + porovnanie RabbitMQ vs. Kafka |

## Zadanie v skratke

- **Vstup 1:** CRUD operácie nad používateľom (`/user`).
- **Vstup 2:** `POST /notification` s `{ userId, type }`, typ je SMS / EMAIL / PUSH.
- **Priepustnosť:** 1 000 000 / 10 s (100 000 správ/s).
- **Doplnená otázka počas pohovoru:** každá notifikácia musí byť v audit logu.
