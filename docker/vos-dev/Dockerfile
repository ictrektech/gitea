ARG GO_IMAGE=docker.m.daocloud.io/library/golang:1.27-alpine3.24
FROM ${GO_IMAGE}

RUN sed -i s/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g /etc/apk/repositories \
 && apk add --no-cache bash git git-lfs make nodejs pnpm postgresql-client curl

# air is installed by the entrypoint into a volume: building it in the image stalls on some build hosts.
ENV GOPROXY=https://goproxy.cn \
    GOBIN=/opt/air \
    PATH=/opt/air:/go/bin:$PATH \
    HOME=/root

# The source tree belongs to the host user; git runs inside this container as root.
RUN git config --global --add safe.directory /src

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY docker/vos-dev/entrypoint.sh /opt/vos-dev/entrypoint.sh
RUN chmod +x /opt/vos-dev/entrypoint.sh

ENTRYPOINT ["/opt/vos-dev/entrypoint.sh"]
