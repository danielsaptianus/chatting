# 💬 ChatSphere - Real-Time Chat Application

<div align="center">

  **Aplikasi Obrolan Real-Time Modern dengan NestJS 11, Prisma 7, PostgreSQL, Socket.io, dan Native Frontend SPA**

  [![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
  [![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?style=flat&logo=prisma&logoColor=white)](https://www.prisma.io/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=flat&logo=socket.io&logoColor=white)](https://socket.io/)
  [![Frontend](https://img.shields.io/badge/Frontend-Native_Vanilla_SPA-F7DF1E?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## 🌟 Ikhtisar Proyek

**ChatSphere** adalah aplikasi perpesanan instan *real-time* lengkap yang dirancang dengan arsitektur **Modular Monolith** berbasis **NestJS 11** dan antarmuka web modern **Native Single Page Application (SPA)** bertema *sleek glassmorphic dark mode*.

Aplikasi ini mendukung perpesanan pribadi 1-on-1 (*Personal Chat / Direct Message*), grup obrolan privat dengan ketentuan persetujuan admin ala **WhatsApp** (*Invite Link & Admin Approval*), serta sistem notifikasi instan ganda (*WebSocket + PostgreSQL persistence*).

---

## ✨ Fitur Utama

### 🔐 1. Autentikasi & Otorisasi (RBAC)
- **Login JWT**: Autentikasi aman berbasis JSON Web Token dengan hashing password menggunakan **bcrypt**.
- **Role-Based Access Control**: Pemisahan izin antara `ADMIN` (administrator sistem) dan `USER` (pengguna biasa).
- **Reset Password**: Alur reset password menggunakan token unik bertenggang waktu (`/auth/reset-password-request` & `/auth/reset-password`).
- **Logout**: Pembersihan sesi dan token secara aman.

### 👤 2. Manajemen Pengguna & Biodata
- **Pemisahan Kredensial & Biodata**:
  - `User`: Menyimpan identitas akun (`email`, `password`, `deleted_at`).
  - `Biodata`: Menyimpan profil (`first_name`, `last_name`, `role`, `is_active`).
- **Registrasi oleh Admin**: Pendaftaran akun baru dilakukan oleh Administrator sistem.
- **Soft Delete**: Penghapusan pengguna secara aman (*soft delete*) dengan mempertahankan integritas data riwayat obrolan.
- **Daftar Pengguna**: Pengguna biasa dapat mencari sesama akun aktif untuk memulai obrolan langsung (PC).

### 💬 3. Pesan Pribadi (Personal Chat / PC / Direct Message)
- **Obrolan 1-on-1 Real-time**: Komunikasi langsung instan via WebSocket event `pc_message`.
- **Riwayat Obrolan**: Penyimpanan dan pemuatan riwayat pesan lengkap.
- **Daftar Kontak Percakapan**: Menampilkan kontak-kontak yang aktif saling bertukar pesan di sidebar.
- **Floating Toast Alert**: Peringatan pesan baru otomatis muncul saat pengguna membuka percakapan lain.

### 👥 4. Grup Obrolan ala WhatsApp (WhatsApp-Style Group Chat)
- **Grup Bersifat Privat**: Tidak ada direktori terbuka publik. Semua grup bersifat tertutup.
- **Tautan Undangan (Invite Link / Code)**:
  - Setiap grup memiliki kode unik otomatis (contoh: `inv_a1b2c3d4`).
  - Admin/Owner grup dapat menyalin tautan undangan (`http://localhost:3000/#invite=inv_xxx`) atau menarik/me-reset tautan kapan saja (*Revoke Link*).
- **Pratinjau Grup (Preview)**:
  - Calon anggota dapat melihat info aman grup (Nama, Deskripsi, Jumlah Anggota) sebelum masuk.
- **Persetujuan Admin/Owner (*Approve New Participants*)**:
  - Calon anggota yang membuka tautan menekan tombol **"Minta Bergabung"** (status `PENDING`).
  - Admin dan Owner grup menerima notifikasi real-time dan melihat daftar pemohon pada panel detail grup.
  - Admin/Owner dapat **Menyetujui (Terima)** atau **Menolak (Tolak)** permohonan.
- **Manajemen Anggota**:
  - Tambah anggota langsung (*Add Member*) hanya bisa dilakukan oleh Owner/Admin grup.
  - Keluarkan anggota (*Remove Member*) oleh Owner/Admin grup.
  - Keluar dari grup secara mandiri (*Leave Group*) oleh anggota biasa.
- **Pesan Grup Real-time**: Pengiriman pesan teks grup instan yang disiarkan ke seluruh anggota di room WebSocket terkait.

### 🔔 5. Notifikasi Real-Time & Persisten
Notifikasi disimpan di PostgreSQL dan disiarkan secara *live* melalui WebSocket namespace `/ws`:
1. 👤 `USER_REGISTERED`: User baru terdaftar ke sistem oleh Admin.
2. 🎉 `ADDED_TO_GROUP`: Pengguna ditambahkan langsung ke dalam grup.
3. ⚠️ `REMOVED_FROM_GROUP`: Pengguna dikeluarkan dari grup atau saat anggota keluar.
4. 👥 `USER_JOINED_GROUP`: Anggota baru berhasil bergabung setelah disetujui.
5. 📩 `JOIN_REQUEST_RECEIVED`: Notifikasi ke Owner/Admin saat ada permintaan masuk grup via tautan.
6. ✅ `JOIN_REQUEST_APPROVED`: Notifikasi ke pemohon bahwa permohonannya disetujui.
7. ❌ `JOIN_REQUEST_REJECTED`: Notifikasi ke pemohon bahwa permohonannya ditolak.
- Dilengkapi **Unread Badge Counter**, **Dropdown Riwayat Notifikasi**, dan **Floating Toast Notification**.

### 🎨 6. Frontend Native SPA (100% Vanilla Web)
- Dibangun murni menggunakan **HTML5, CSS3, dan JavaScript ES6+**.
- Tanpa dependensi framework frontend (React/Vue/Angular) atau TailwindCSS.
- Tema **Sleek Glassmorphic Dark Mode** (`backdrop-filter`, palet HSL harmonis, font Google Inter).
- Disajikan langsung (*zero-config static hosting*) oleh NestJS melalui folder `public/`.

---

## 🛠️ Tech Stack & Arsitektur

```text
chatting/
├── src/                         # Backend NestJS Modular Monolith
│   ├── common/                  # Guards, Decorators, Prisma Service, Filters
│   ├── config/                  # App, Database, JWT Configuration
│   ├── modules/
│   │   ├── auth/                # Login, Password Reset, JWT Strategy
│   │   ├── users/               # Users CRUD, Biodata, Soft Delete
│   │   ├── chat/                # Group & PC Chatting, Invite Links, Approvals
│   │   ├── notifications/       # Notification Service & Socket.io Gateway (/ws)
│   │   └── health/              # Health check (/health & /ping)
│   ├── app.module.ts            # Root application module
│   └── main.ts                  # Bootstrap, Swagger setup & Static asset serving
├── public/                      # Native Frontend Single Page Application
│   ├── index.html               # SPA Layout (Auth, Chat Stream, Drawer, Modals)
│   ├── css/
│   │   └── style.css            # Glassmorphic dark styling & responsive UI
│   └── js/
│       ├── api.js               # REST Client Wrapper dengan JWT Token handling
│       ├── socket.js            # Socket.io Client Manager di namespace /ws
│       └── app.js               # State management, Event listeners & DOM controls
├── prisma/
│   ├── schema.prisma            # Skema basis data PostgreSQL
│   └── seeder/                  # Data seeder awal (Admin & User demo)
├── FITUR.md                     # Dokumentasi detail spesifikasi fitur
└── README.md                    # Panduan utama proyek
```

---

## 📊 Skema Basis Data (Database Schema)

```mermaid
erDiagram
    User ||--o| Biodata : "1-to-1 profile"
    User ||--o{ PasswordResetToken : "requests"
    User ||--o{ Group : "creates"
    User ||--o{ GroupMember : "belongs to"
    User ||--o{ GroupJoinRequest : "applies"
    User ||--o{ GroupMessage : "sends"
    User ||--o{ DirectMessage : "sends/receives"
    User ||--o{ Notification : "receives"

    Group ||--o{ GroupMember : "contains"
    Group ||--o{ GroupJoinRequest : "receives"
    Group ||--o{ GroupMessage : "contains"
```

---

## ⚙️ Persyaratan Sistem (Prerequisites)

- **Node.js**: `>= 18.x` (disarankan `>= 20.x`)
- **PostgreSQL**: `>= 14.x`
- **npm**: `>= 9.x`

---

## 🚀 Panduan Instalasi & Menjalankan Aplikasi

### 1. Klon Repositori
```bash
git clone https://github.com/danielsaptianus/chatting.git
cd chatting
```

### 2. Instal Dependensi
```bash
npm install
```

### 3. Konfigurasi Environment (`.env`)
Salin file `.env.example` ke `.env` dan sesuaikan kredensial PostgreSQL Anda:
```env
# Application
NODE_ENV=development
PORT=3000

# Database (PostgreSQL)
DATABASE_URL=postgresql://username:password@localhost:5432/chatting_db?schema=public

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d

# Swagger
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
```

### 4. Sinkronisasi Basis Data & Seeder
```bash
# Sinkronkan skema Prisma ke PostgreSQL
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Isi data awal (Seeder)
npm run prisma:seed
```

### 5. Jalankan Aplikasi
```bash
# Mode pengembangan (Watch mode)
npm run start:dev

# Mode produksi
npm run build
npm run start:prod
```

Aplikasi web dapat diakses langsung di peramban:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🔑 Akun Demo Bawaan

Gunakan akun berikut untuk menguji aplikasi:

| Peran (Role) | Email | Kata Sandi | Deskripsi |
|---|---|---|---|
| **Administrator** | `admin@chatting.com` | `password123` | Memiliki akses manajemen user dan membuat grup. |
| **Pengguna Biasa** | `user@chatting.com` | `password123` | Pengguna standar untuk chat grup, personal chat, dan invite link. |

> 💡 **Tips Pengujian Real-Time**: Buka jendela peramban normal untuk `admin@chatting.com` dan jendela *Incognito* untuk `user@chatting.com` guna menguji chat instan dan notifikasi real-time antar dua akun secara langsung.

---

## 📖 Dokumentasi API (Swagger) & Health Check

- **Swagger UI Interactive**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- **Health Check Endpoint**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
- **Ping Endpoint**: [http://localhost:3000/api/v1/health/ping](http://localhost:3000/api/v1/health/ping)
- **Prisma Studio (Database GUI)**:
  ```bash
  npx prisma studio
  ```
  Akses di [http://localhost:5555](http://localhost:5555).

---

## 🧪 Pengujian Unit & Build

```bash
# Menjalankan pengujian unit (Jest)
npm test

# Menjalankan pengujian unit dengan coverage
npm run test:cov

# Menjalankan pengujian build kompilasi
npm run build
```

---

## 🌿 Alur Git Branching

Repositori GitHub: **[https://github.com/danielsaptianus/chatting.git](https://github.com/danielsaptianus/chatting.git)**

Proyek ini mengadopsi standar **Semantic Commit** dan strategi tiga branch:
1. `development`: Branch kerja aktif untuk penambahan fitur dan perbaikan.
2. `staging`: Branch integrasi dan pengujian sebelum rilis.
3. `main`: Branch produksi yang stabil.

---

## 📄 Lisensi

Proyek ini berada di bawah lisensi [MIT](LICENSE).