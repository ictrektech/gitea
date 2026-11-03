ARG NODE_IMAGE=docker.m.daocloud.io/library/node:24-alpine3.24
ARG GO_IMAGE=docker.m.daocloud.io/library/golang:1.27-alpine3.24
FROM ${GO_IMAGE} AS build
RUN sed -i s/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g /etc/apk/repositories && apk add --no-cache build-base git nodejs pnpm
ENV GOPROXY=https://goproxy.cn GITHUB_REF_TYPE=branch GITHUB_REF_NAME=main
WORKDIR /src
COPY go.mod go.sum package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
ARG GITEA_VERSION
RUN --mount=type=cache,target=/root/.cache/go-build --mount=type=cache,target=/go/pkg/mod make GITEA_VERSION="$GITEA_VERSION" fmt && make GITEA_VERSION="$GITEA_VERSION" TAGS="bindata timetzdata" build

FROM ${NODE_IMAGE}
RUN sed -i s/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g /etc/apk/repositories && apk add --no-cache bash git git-lfs openssh-client postgresql-client ca-certificates su-exec
COPY --from=build /src/gitea /usr/local/bin/gitea
COPY docker/vos /opt/vos
RUN chmod +x /opt/vos/entrypoint.sh
ENV USER=node HOME=/data/git
EXPOSE 8080 2222
ENTRYPOINT ["/opt/vos/entrypoint.sh"]
