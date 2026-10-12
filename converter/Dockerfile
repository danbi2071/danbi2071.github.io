# .hwpx → PDF 변환 서버 (LibreOffice + 한글 확장 H2Orestart)
#   docker build -t doc-clean-pdf converter
#   docker run -d --name doc-clean-pdf -p 8080:8080 doc-clean-pdf
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# LibreOffice(화면 없는 버전) + 확장 실행용 Java + 한글 글꼴 + Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-java-common default-jre-headless \
      fonts-nanum fonts-nanum-extra fonts-noto-cjk \
      nodejs ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# 한글(.hwp/.hwpx)을 LibreOffice 에서 열 수 있게 해 주는 확장
ARG H2O_VERSION=v0.7.14
RUN curl -fsSL -o /tmp/H2Orestart.oxt \
      "https://github.com/ebandal/H2Orestart/releases/download/${H2O_VERSION}/H2Orestart.oxt" \
  && unopkg add --shared /tmp/H2Orestart.oxt \
  && rm /tmp/H2Orestart.oxt

RUN useradd -m conv
WORKDIR /app
COPY server.js .
USER conv

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://localhost:8080/health || exit 1
CMD ["node", "server.js"]
