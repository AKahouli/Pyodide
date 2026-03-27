FROM ubuntu:22.04 AS build

# Set environment variables for configuration
ENV PYTHON_VERSION=3.10

RUN sed -i 's|https://archive.ubuntu.com/ubuntu|https://mirrors.kernel.org/ubuntu|g' /etc/apt/sources.list \
    && apt update && apt upgrade -y \
    && apt install --no-install-recommends -y ffmpeg libsm6 libxext6 pip build-essential python${PYTHON_VERSION} python${PYTHON_VERSION}-dev wget \
    && apt-get clean \
    && useradd -m azureuser

ADD https://fr.archive.ubuntu.com/ubuntu/pool/main/o/openssl1.0/libssl1.0.0_1.0.2n-1ubuntu5_amd64.deb /tmp/libssl1.0.0_1.0.2n-1ubuntu5_amd64.deb
ADD https://packages.microsoft.com/config/ubuntu/20.04/packages-microsoft-prod.deb /tmp/packages-microsoft-prod.deb

RUN dpkg -i /tmp/libssl1.0.0_1.0.2n-1ubuntu5_amd64.deb && \
    dpkg -i /tmp/packages-microsoft-prod.deb 

WORKDIR /vectorstore-api

COPY requirements.txt /vectorstore-api/requirements.txt

RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir pytest-cov 

COPY src src
COPY main.py worker.py .

RUN rm -rf /tmp/shared \
    && chown -R azureuser .

RUN mkdir -p /tmp/shared && chown -R azureuser:azureuser /tmp/shared
USER azureuser
EXPOSE 3013
ENV LOG_LEVEL=DEBUG

ENTRYPOINT ["python3.10", "-m"]

CMD ["main"]
