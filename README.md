# 개발환경: Node.js v20 + PostgreSQL v16 + Socket.IO

간단한 Socket.IO 실시간 예제와 PostgreSQL 16을 Docker Compose로 구성합니다. 서버는 포트 `5000`을 사용합니다.

빠른 시작

1. `.env.example` 를 복사하여 `.env`로 저장하고 필요시 값 수정

```bash
cp .env.example .env
docker compose up --build
```

2. 브라우저에서 `http://localhost:5000` 열기

설정 파일
- `docker-compose.yml`: Postgres 16과 앱 컨테이너(포트 5000)
- `Dockerfile`: Node.js 20 이미지 기반
- `db/init.sql`: 컨테이너 초기화 시 `messages` 테이블 생성

호스팅 및 도메인(간단 가이드)

- VPS(예: AWS EC2, DigitalOcean Droplet)
  1. 서버에 Docker 및 Docker Compose 설치
  2. 이 레포지토리 복제 후 `docker compose up -d --build`
  3. 도메인 DNS에서 A 레코드를 서버 공인 IP로 설정
  4. SSL: `nginx`와 `certbot` 또는 제공업체의 자동 SSL 사용

- 플랫폼(간편 배포): Render, Railway, Fly, DigitalOcean App Platform
  - Dockerfile이 있으므로 플랫폼에서 Docker 배포를 선택하면 됩니다.
  - 환경변수: `DATABASE_URL`을 Postgres 연결 문자열로 설정

도메인 설정 요약
- DNS: A 레코드(예: `example.com` → 서버 IP), CNAME 또는 www 레코드 추가
- HTTPS: Let's Encrypt 또는 호스팅 제공 SSL 사용 권장

지원이나 배포 대행 원하시면 어떤 호스팅 서비스를 원하시는지 알려주세요 (예: DigitalOcean, Render, Railway). 도메인도 알려주시면 DNS 예시 값을 제공합니다.

## Heroku 배포 안내

간단한 Heroku 배포 절차입니다. 이 레포는 `Node.js` 시작 스크립트와 `process.env.PORT`, `DATABASE_URL`을 사용하므로 Heroku에 바로 배포할 수 있습니다.

- **파일 추가:** 루트에 `Procfile`(이미 포함됨)로 `web: node src/server.js`가 설정되어 있습니다.
- **의존성 확인:** `package.json`에 `start` 스크립트와 `engines.node`가 정의되어 있어야 합니다. (이미 설정됨)

기본 배포 절차 (Heroku CLI 사용):

```bash
# Heroku CLI 설치 후 로그인
heroku login

# Git 리포지토리가 준비되어 있어야 합니다. (예: main 브랜치)
git add .
git commit -m "Prepare for Heroku"

# Heroku 앱 생성
heroku create your-app-name

# PostgreSQL 애드온 추가 (hobby-dev 플랜 예시)
heroku addons:create heroku-postgresql:hobby-dev

# (옵션) NODE_ENV 설정
heroku config:set NODE_ENV=production

# 배포 (브랜치명이 main인 경우)
git push heroku main

# 로그 확인
heroku logs --tail

# 브라우저에서 열기
heroku open
```

설명:
- `heroku addons:create heroku-postgresql` 명령은 자동으로 `DATABASE_URL` 환경변수를 설정합니다. 서버는 이 값을 `pg` 연결 문자열로 사용합니다.
- Socket.IO는 Heroku에서 WebSocket을 지원하므로 코드상 특별한 변경은 필요 없습니다. 다만 다수의 dyno로 수평 확장할 경우 메시지 브로드캐스트를 위해 `socket.io-redis` 또는 `@socket.io/redis-adapter` 같은 어댑터를 사용해야 합니다.

문제 해결 팁:
- 배포 후 DB 연결 에러가 발생하면 `heroku config`로 `DATABASE_URL` 값이 있는지 확인하세요.
- 포트 관련 문제는 서버가 이미 `process.env.PORT`를 사용하므로 보통 발생하지 않습니다.

원하시면 제가 Heroku 앱 생성, Postgres 프로비저닝, 그리고 첫 배포까지 CLI로 직접 수행해드릴게요. 진행할까요?

