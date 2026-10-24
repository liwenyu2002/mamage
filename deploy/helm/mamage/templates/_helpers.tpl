{{- define "mamage.name" -}}
{{- printf "%s-mamage" .Release.Name | trunc 48 | trimSuffix "-" -}}
{{- end -}}
{{- define "mamage.labels" -}}
app.kubernetes.io/name: mamage
app.kubernetes.io/instance: {{ .Release.Name | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}
{{- define "mamage.image" -}}
{{- $repo := required "image repository is required" .repository -}}
{{- if .digest -}}
{{- printf "%s@%s" $repo .digest -}}
{{- else -}}
{{- $tag := required "set an immutable release image tag or digest" .tag -}}
{{- if eq $tag "latest" -}}{{- fail "latest image tags are forbidden" -}}{{- end -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}
{{- define "mamage.validate" -}}
{{- if and (or (gt (int .Values.api.replicaCount) 1) .Values.api.autoscaling (eq .Values.api.strategy "RollingUpdate")) (ne .Values.persistence.data.accessMode "ReadWriteMany") -}}
{{- fail "multiple API Pods, HPA and RollingUpdate require a genuinely shared ReadWriteMany data claim" -}}
{{- end -}}
{{- if and .Values.api.autoscaling (gt (int .Values.api.minReplicas) (int .Values.api.maxReplicas)) -}}{{- fail "minReplicas must not exceed maxReplicas" -}}{{- end -}}
{{- if or (lt (int .Values.api.replicaCount) 1) (gt (int .Values.api.replicaCount) 32) -}}{{- fail "API replicaCount must be between 1 and 32" -}}{{- end -}}
{{- if and (or (gt (int .Values.web.replicaCount) 1) (eq .Values.web.strategy "RollingUpdate")) (ne .Values.persistence.webAssets.accessMode "ReadWriteMany") -}}{{- fail "multiple web Pods and RollingUpdate require a genuinely shared ReadWriteMany webAssets claim" -}}{{- end -}}
{{- if or (lt (int .Values.web.replicaCount) 1) (gt (int .Values.web.replicaCount) 32) -}}{{- fail "web replicaCount must be between 1 and 32" -}}{{- end -}}
{{- if lt (int .Values.api.terminationGracePeriodSeconds) (add (int .Values.api.shutdownTimeoutSeconds) 10 | int) -}}
{{- fail "termination grace must exceed shutdown timeout by at least 10 seconds" -}}
{{- end -}}
{{- $url := required "publicURL must be the browser-reachable origin" .Values.publicURL -}}
{{- if not (regexMatch "^https?://[^/@?#[:space:]]+/?$" $url) -}}{{- fail "publicURL must be an HTTP(S) origin without a path or credentials" -}}{{- end -}}
{{- $hubFaces := has (default "local" .Values.config.FACE_INFERENCE_PROVIDER) (list "zgcai" "hub") -}}
{{- if and (not $hubFaces) (empty .Values.modelServices.faceURL) -}}{{- fail "local face provider requires modelServices.faceURL" -}}{{- end -}}
{{- $endpoints := dict "objectStorage.endpoint" .Values.objectStorage.endpoint -}}
{{- if .Values.modelServices.faceURL -}}{{- $_ := set $endpoints "modelServices.faceURL" .Values.modelServices.faceURL -}}{{- end -}}
{{- range $key, $value := $endpoints -}}
{{- if not (regexMatch "^https?://[^/]+(/[^[:space:]]*)?$" $value) -}}{{- fail (printf "%s must be a reachable HTTP(S) endpoint" $key) -}}{{- end -}}
{{- if regexMatch "^https?://[^/]*@" $value -}}{{- fail (printf "%s must not contain credentials" $key) -}}{{- end -}}
{{- if regexMatch "^https?://(127\\.|localhost([:/]|$)|\\[::1\\])" $value -}}{{- fail (printf "%s must not refer to a different service through loopback" $key) -}}{{- end -}}
{{- end -}}
{{- if and .Values.modelServices.visionURL (not (regexMatch "^https?://" .Values.modelServices.visionURL)) -}}{{- fail "visionURL must be HTTP(S)" -}}{{- end -}}
{{- if regexMatch "^https?://[^/]*@" .Values.modelServices.visionURL -}}{{- fail "visionURL must not contain credentials" -}}{{- end -}}
{{- if regexMatch "^https?://(127\\.|localhost([:/]|$)|\\[::1\\])" .Values.modelServices.visionURL -}}{{- fail "visionURL must not use Pod loopback" -}}{{- end -}}
{{- with .Values.modelServices.mediaCallbackURL -}}
{{- if not (regexMatch "^https?://[^/@?#[:space:]]+/api/image$" .) -}}{{- fail "mediaCallbackURL must be an HTTP(S) image endpoint without credentials" -}}{{- end -}}
{{- if regexMatch "^https?://(127\\.|localhost([:/]|$)|\\[::1\\])" . -}}{{- fail "mediaCallbackURL must be reachable by the external model service" -}}{{- end -}}
{{- end -}}
{{- if and (has (default "off" .Values.config.AI_VISION_PROVIDER) (list "ollama" "local" "qwen" "qwen-local")) (empty .Values.modelServices.visionURL) -}}{{- fail "local vision provider requires modelServices.visionURL" -}}{{- end -}}
{{- $reserved := list "NODE_ENV" "PORT" "MAMAGE_CONTAINER" "MAMAGE_DISTRIBUTED_RUNTIME" "HOME" "TMPDIR" "XDG_CACHE_HOME" "PLAYWRIGHT_BROWSERS_PATH" "FFMPEG_PATH" "FFPROBE_PATH" "ORGANIZATION_UNITS_ACTIVE" "MEDIA_URL_SIGNING" "UPLOAD_ABS_DIR" "UPLOAD_BASE_URL" "INTERNAL_UPLOAD_BASE_URL" "VIDEO_WORK_DIR" "UPLOAD_VIDEO_TMP_DIR" "SHUTDOWN_TIMEOUT_MS" "AI_VALIDATE_ON_STARTUP" "PYTHON_PATH" "IMAGE_SIMILARITY_PYTHON_PATH" "TORCH_HOME" "COS_BASE_URL" "COS_REGION" "COS_FORCE_PATH_STYLE" "FACE_DETECTOR_SERVICE_URL" "FACE_DETECTOR_SERVICE_REQUIRED" "FACE_DETECTOR_USE_SERVICE" "OLLAMA_BASE_URL" -}}
{{- range $key, $value := .Values.config -}}
{{- if or (has $key $reserved) (regexMatch "(^|_)(SECRET|PASSWORD|PASS|API_KEY|TOKEN|ACCESS_KEY|CREDENTIAL)(_|$)" $key) (regexMatch "^[a-zA-Z]+://[^/]*@" $value) -}}{{- fail (printf "%s must not be supplied in config; use the Secret or chart-owned settings" $key) -}}{{- end -}}
{{- end -}}
{{- if and .Values.ingress.enabled (or (empty .Values.ingress.className) (empty .Values.ingress.host)) -}}{{- fail "ingress requires className and host, with reviewed controller-specific annotations" -}}{{- end -}}
{{- end -}}
