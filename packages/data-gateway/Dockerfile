# λORM service (L8): Node 24 LTS like CI; the CLI is this project's @lambdaorm/cli (the old unscoped lambdaorm-cli
# is not maintained). Build: `npx grunt dist` in packages/service, then `docker build .` — the dist installs the
# published @lambdaorm/base and @lambdaorm/lib of the versions in this repo, so publish them first.
FROM node:24-bookworm-slim
RUN npm config set loglevel warn \
	&& npm config set maxsockets 5 \
	&& npm config set progress false
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libaio1 unzip wget ca-certificates \
	&& wget -q https://download.oracle.com/otn_software/linux/instantclient/1918000/instantclient-basic-linux.x64-19.18.0.0.0dbru.zip -O instantclient.zip \
	&& unzip -q instantclient.zip \
	&& rm instantclient.zip \
	&& wget -q https://download.oracle.com/otn_software/linux/instantclient/1918000/instantclient-sqlplus-linux.x64-19.18.0.0.0dbru.zip -O instantclient-sqlplus.zip \
	&& unzip -q instantclient-sqlplus.zip \
	&& rm instantclient-sqlplus.zip \
	&& mkdir -p /opt/oracle \
	&& mv instantclient_19_18 /opt/oracle \
	&& apt-get purge -y unzip wget \
	&& apt-get autoremove -y \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_19_18:$LD_LIBRARY_PATH \
	PATH=/opt/oracle/instantclient_19_18:$PATH
ARG CLI_VERSION=1.6.0
RUN npm install -g @lambdaorm/cli@${CLI_VERSION}
WORKDIR /usr/src/app
COPY ./dist .
RUN npm install --omit=dev
VOLUME ["/workspace"]
USER 1000
CMD ["npm","run","start"]
LABEL maintainer="flaviolrita@hotmail.com"
