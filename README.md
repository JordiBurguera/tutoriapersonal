# 📋 Tutoria Personal — proposta a Digitalització

<div align="center">

**Sistema web que substitueix el Google Form d'elecció de tutoria personal de Les Carolines**

<pre align="center">
&lt;/&gt; construït per alumnat, per a l'institut
</pre>

![Node.js](https://img.shields.io/badge/Node.js-22.13+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node:sqlite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-temps%20real-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2024-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Nodemailer](https://img.shields.io/badge/Nodemailer-SMTP-22B573?style=for-the-badge&logo=gmail&logoColor=white)

</div>

---

## Per a què serveix

El Google Form arreplega respostes, però no reparteix tutor a ningú: algú ha de creuar preferències a mà, parlar amb cada professor i mantindre la llista final.

**Tutoria Personal** automatitza tot el procés: l'alumnat ordena les seues preferències arrossegant, el sistema envia la sol·licitud en cascada fins que un professor l'accepta, i administració només intervé en els casos excepcionals.

Ja és un prototip funcional, provat amb dades d'exemple. El que demanem a Digitalització és que ens deixe donar-ho a conéixer i posar-ho en marxa per a l'institut.

---

## Captures

<div align="center">

**Accés sense contrasenya, amb el correu de l'institut**

<img src=".screenshots/captura-login.jpg" width="800" alt="Pantalla d'accés de Tutoria Personal">

<br><br>

**L'alumnat ordena el professorat arrossegant**

<img src=".screenshots/captura-votacio-alumnat.jpg" width="800" alt="Votació de l'alumnat amb drag and drop">

<br><br>

**El professorat confirma o rebutja sol·licituds**

<img src=".screenshots/captura-tauler-professorat.jpg" width="800" alt="Tauler del professorat amb sol·licituds pendents">

<br><br>

**L'alumnat veu el seu tutor assignat**

<img src=".screenshots/captura-tutor-alumnat.jpg" width="800" alt="Vista de l'alumnat amb el seu tutor personal">

<br><br>

**Administració gestiona comptes**

<img src=".screenshots/captura-admin-comptes.jpg" width="800" alt="Panell d'administració de comptes">

<br><br>

**Pas de curs automatitzat al tancament de l'any**

<img src=".screenshots/captura-pas-de-curs.jpg" width="800" alt="Panell de pas de curs">

</div>

---

## Flux de l'elecció

```mermaid
flowchart TD
    A[Alumne entra amb correu de l'institut] --> B[Ordena professorat per preferencia]
    B --> C{Posa primer al seu<br>tutor de l'any anterior?}
    C -- Si --> D[Confirmat a l'instant]
    C -- No --> E[Sol·licitud a la primera preferencia]
    E --> F{Professor accepta?}
    F -- Si --> G[Tutor assignat]
    F -- No --> H{Queden preferencies<br>sense vetar?}
    H -- Si --> E
    H -- No --> I[Llista esgotada]
    I --> J[Administracio assigna a ma]
    G --> K[Eleccio es pot tancar<br>quan tots tenen tutor]
    J --> K
```

**Repetidors i pas de curs**, en tancar l'elecció:

```mermaid
flowchart LR
    X[Eleccio tancada] --> Y[Admin marca per classe:<br>no promociona / es dona de baixa]
    Y --> Z[Confirmar]
    Z --> P[Resta puja 1 curs,<br>conserva grup i tutor]
    Z --> Q[No promociona:<br>conserva curs i historial]
    Z --> R[Baixes i 4t:<br>compte eliminat]
```

---

## Funcionalitats principals

| Per a qui | Què fa |
|---|---|
| **Alumnat** | Entra sense contrasenya per enllaç al correu · ordena professorat arrossegant (ratolí i tàctil) · fins a 2 vetos opcionals · veu el tutor de l'any anterior · s'autoconfirma si el repeteix · consulta el seu tutor i lloc de reunió |
| **Professorat** | Accepta o rebutja sol·licituds · veu la seua llista d'alumnat tutoritzat · correu directe a un o a tots · defineix lloc de reunió · pot ser tutor de grup d'una o diverses classes, ho canvia quan vulga · mostra d'una ullada (donut) l'estat de la seua classe |
| **Administració** | Convoca i tanca eleccions · assigna tutor a mà a qui es va quedar sense cap · dona d'alta professorat i administració · gestiona comptes i rols · exporta PDF amb tutors, departaments i llocs de reunió · executa el *pas de curs* amb revisió abans de confirmar |
| **Sistema** | Recordatori diari automàtic (sense noms, només avís) · tot en temps real per WebSocket · base de dades SQLite amb migració automàtica · test suite d'extrem a extrem |

La llista completa (142 funcionalitats verificades una a una) està en [`SUMMARY.md`](SUMMARY.md).

---

## Stack tècnic

| Peça | Tecnologia |
|---|---|
| Backend | Node.js 22 + Express 5, sense framework pesat |
| Base de dades | SQLite (`node:sqlite`), un sol arxiu |
| Temps real | WebSocket natiu (`ws`) |
| Correu | Nodemailer sobre SMTP de Gmail |
| PDF | PDFKit, cartell A3 per tutor |
| Frontend | HTML, CSS i JavaScript sense dependències de build, amb SortableJS per a l'arrossegar |
| Tests | `node --test`, prova d'extrem a extrem de l'API |

Zero dependències de pagament. Tot programari lliure.

