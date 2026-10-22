# Evidence: requirement by requirement

Each section gives the requirement, what satisfies it in this repository, the commands or results that prove it,
and the screenshots (stored in [docs/screenshots/](docs/screenshots/)). The architecture is in the
[README](README.md).

- Application URL: `http://k8s-blogapp-blogappi-d90fd8a440-1308316034.ap-south-1.elb.amazonaws.com`
- Region: `ap-south-1`. Cluster: `blogapp-eks-cluster`. Namespace: `blogapp`.

| # | Requirement | Section |
| --- | --- | --- |
| 1 | Application | [1](#1-application) |
| 2 | Docker | [2](#2-docker) |
| 3 | Database | [3](#3-database) |
| 4 | Nexus and ECR | [4](#4-nexus-and-ecr) |
| 5 | SonarQube | [5](#5-sonarqube) |
| 6 | Trivy | [6](#6-trivy) |
| 7 | Amazon EKS | [7](#7-amazon-eks) |
| 8 | Kubernetes deployment | [8](#8-kubernetes-deployment) |
| 9 | Configuration and secrets | [9](#9-configuration-and-secrets) |
| 10 | CI/CD pipeline (Jenkins) | [10](#10-cicd-pipeline-jenkins) |
| 11 | Deployment strategy | [11](#11-deployment-strategy) |
| 12 | Monitoring | [12](#12-monitoring) |
| 13 | Logging | [13](#13-logging) |
| 14 | Security | [14](#14-security) |

---

## 1. Application

**Requirement:** frontend, backend and database working together; submit the application URL and evidence.

**Satisfied by:** [frontend/](frontend/), [backend/](backend/), [database/init.sql](database/init.sql). The browser talks to
the frontend; nginx forwards `/api/` to the backend; the backend reads and writes MySQL.

**Proof:** registering a user, publishing a post and adding a comment through the public URL; `/readyz` returns
`{"status":"ready"}`, which means the backend can reach the database.

![Application on the ALB URL](docs/screenshots/p4-app-alb.png)
![Application running locally in Docker](docs/screenshots/p1-app-local.png)

## 2. Docker

**Requirement:** multi-stage builds, minimal production images, non-root containers, `.dockerignore`, health checks,
no hardcoded credentials.

**Satisfied by:** [backend/Dockerfile](backend/Dockerfile), [frontend/Dockerfile](frontend/Dockerfile),
[backend/.dockerignore](backend/.dockerignore), [frontend/.dockerignore](frontend/.dockerignore),
[backend/.env.example](backend/.env.example), [frontend/.env.example](frontend/.env.example),
[docker-compose.yml](docker-compose.yml).

- Two stages in each Dockerfile; the final images contain no build tools (the backend runtime image has npm removed).
- Final image sizes: frontend about 74 MB, backend about 222 MB before the Node 22 update.
- Non-root: backend `USER 1000:1000`, frontend `USER 101`. Both define a `HEALTHCHECK`.
- `.env` files are not in the images (`.dockerignore`) or in Git (`.gitignore`); `.env.example` files hold placeholders only.

![Backend image build](docs/screenshots/p1-build-backend.png)
![Frontend image build](docs/screenshots/p1-build-frontend.png)
![Image sizes](docs/screenshots/p1-images.png)
![Containers healthy under Docker Compose](docs/screenshots/p1-compose-healthy.png)
![Containers run as non-root](docs/screenshots/p1-nonroot.png)

## 3. Database

**Requirement (Option A):** database on Kubernetes with persistent storage, reachable only by the backend, secure
credentials, schema initialised, data kept across pod restarts.

**Satisfied by:** [k8s/app/mysql.yaml](k8s/app/mysql.yaml) (StatefulSet, headless Service, encrypted `gp3` volume),
[k8s/admin/base.yaml](k8s/admin/base.yaml) (StorageClass), [k8s/app/networkpolicy.yaml](k8s/app/networkpolicy.yaml),
[database/init.sql](database/init.sql) (mounted from a ConfigMap into `/docker-entrypoint-initdb.d`).

**Persistence test (Test B):** a post was created through the public URL, the `mysql-0` pod was deleted, and Kubernetes
created a new pod that attached the **same** volume. The post was still readable through the website and in the database.

| Check | Result |
| --- | --- |
| Pod after deletion | new instance (new pod UID), `1/1 Running` after about 30 seconds |
| Volume after deletion | same PersistentVolume, `pvc-28e49536-48da-46f0-938a-3be1727a805a` |
| Post "Persistence test" | found through the website and in `SELECT * FROM posts` |

![MySQL StatefulSet and volume](docs/screenshots/p4-mysql-sts.png)
![Cluster objects](docs/screenshots/p4-get-all.png)
![Volume bound on gp3](docs/screenshots/p8-B-pvc.png)
![Pod recreated after deletion](docs/screenshots/p8-B-pod-recreated.png)
![Post survived the pod deletion](docs/screenshots/p8-B-post-survived.png)
![Tables and rows in the database](docs/screenshots/p8-B-show-tables.png)

## 4. Nexus and ECR

**Requirement:** build the images, apply unique versions, push to Nexus or ECR, deploy the versioned images to EKS.

**Satisfied by:** stages 5 to 10 of the [Jenkinsfile](Jenkinsfile). Each build tags both images
`<build number>-<git commit>` (for example `8-50a51aa`) and pushes them to **both** Nexus and ECR. The ECR repositories use
immutable tags, so a version can never be overwritten. The deployment uses the ECR image of the same version.

![Nexus repository](docs/screenshots/p3-nexus-repos.png)
![ECR repositories](docs/screenshots/p2-ecr-repos.png)
![Push to Nexus log](docs/screenshots/p5-nexus-push.png)
![Push to ECR log](docs/screenshots/p5-ecr-push.png)
![Versioned images in Nexus](docs/screenshots/p5-nexus-images.png)
![Versioned images in ECR](docs/screenshots/p5-ecr-images.png)
![Cluster runs the same version](docs/screenshots/p5-deploy-version.png)

## 5. SonarQube

**Requirement:** code-quality analysis in the pipeline with a Quality Gate that prevents deployment when it fails.

**Satisfied by:** stage 4 of the [Jenkinsfile](Jenkinsfile) (`sonar-scanner` for backend and frontend, then
`waitForQualityGate abortPipeline: true`). SonarQube reports the result to Jenkins through a webhook.

**Gate failure test (Test C):** see the result below.

![SonarQube projects](docs/screenshots/p3-sonarqube.png)
![Quality Gate conditions](docs/screenshots/p3-sonar-gate.png)
![SonarQube stage passing in the pipeline](docs/screenshots/p5-sonar-stage.png)
![Quality Gate failing in SonarQube](docs/screenshots/p8-C-gate-failed.png)
![Pipeline stopped by the failed gate](docs/screenshots/p8-C-pipeline-aborted.png)

## 6. Trivy

**Requirement:** scan both images before deployment and handle high and critical vulnerabilities.

**Satisfied by:** stage 6 of the [Jenkinsfile](Jenkinsfile): `trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`
on both images, with the reports archived as build artifacts. The first rehearsal found 26 findings in the backend image and
57 in the frontend image; both were fixed in the Dockerfiles (Node 22, npm removed from the runtime image, OS packages
updated, newer nginx base). Both images now scan with 0 findings.

**Failure test (Test D):** see the result below.

![Trivy results in the pipeline](docs/screenshots/p5-trivy-stage.png)
![A vulnerable image is blocked by Trivy](docs/screenshots/p8-D-trivy-failed.png)

## 7. Amazon EKS

**Requirement:** the three tiers on EKS with Services, ConfigMaps, Secrets, persistent storage and an Ingress, externally
reachable.

**Satisfied by:** [eks-cluster.yaml](eks-cluster.yaml) and everything in [k8s/](k8s/). The AWS Load Balancer Controller turns
[k8s/app/ingress.yaml](k8s/app/ingress.yaml) into an internet-facing ALB.

![Cluster active](docs/screenshots/p2-cluster-active.png)
![Nodes ready](docs/screenshots/p2-nodes.png)
![Load Balancer Controller running](docs/screenshots/p2-alb-controller.png)
![Namespace and gp3 storage class](docs/screenshots/p2-namespace-sc.png)

## 8. Kubernetes deployment

**Requirement:** multiple replicas, readiness and liveness probes, requests and limits, rolling updates, service discovery.

**Satisfied by:** [k8s/app/backend.yaml](k8s/app/backend.yaml) and [k8s/app/frontend.yaml](k8s/app/frontend.yaml): 2 replicas,
`RollingUpdate` with `maxUnavailable: 0`, probes, CPU and memory requests and limits. Pods find each other through Services
(`backend-service`, `mysql-service`).

**Self-healing test (Test E):** one backend pod was deleted and a frontend container was crashed while requests were sent to the
public URL. Kubernetes created the replacement backend pod in about 6 seconds and restarted the frontend container
(restart count 0 to 1). Of 160 requests during the test, 159 returned `200` and 1 returned `502`, at the moment nginx was
stopped and before the load balancer's health check noticed.

![Backend deployment: replicas, strategy, probes, limits](docs/screenshots/p4-describe-backend.png)
![Pod replaced after deletion](docs/screenshots/p8-E-self-heal.png)
![Probes and limits](docs/screenshots/p8-E-describe.png)

## 9. Configuration and secrets

**Requirement:** configuration separate from images; no sensitive values in GitHub, Dockerfiles or manifests.

**Satisfied by:** non-sensitive settings in [k8s/app/configmap.yaml](k8s/app/configmap.yaml). Passwords and the JWT secret are
Jenkins credentials, and the pipeline creates the Kubernetes Secret `blogapp-secrets` from them at deploy time. The manifests
reference the Secret with `secretKeyRef`. The backend code has no fallback passwords and refuses to start without them
(covered by tests in [backend/tests/config.test.js](backend/tests/config.test.js)).

![Jenkins credential store (values hidden)](docs/screenshots/p3-jenkins-credentials.png)
![Kubernetes Secret shows sizes, not values](docs/screenshots/p7-secrets-hidden.png)
![No credentials in the repository](docs/screenshots/p7-git-grep.png)

## 10. CI/CD pipeline (Jenkins)

**Requirement:** an automated pipeline with the stages listed in the brief; a commit builds, validates, scans, publishes
and deploys.

**Satisfied by:** [Jenkinsfile](Jenkinsfile): Checkout, Build, Test, SonarQube and Quality Gate, Docker Build, Trivy Scan,
Image Versioning, Nexus push, ECR push, EKS Deployment, Deployment Validation. Builds started by a commit are shown by the
"Started by an SCM change" line.

![Jenkins](docs/screenshots/p3-jenkins.png)
![Installed tools on the Jenkins server](docs/screenshots/p3-tool-versions.png)
![All pipeline stages green](docs/screenshots/p5-stage-view.png)
![Deployment validation ending in a passed smoke test](docs/screenshots/p5-validation-log.png)
![Build started by a commit](docs/screenshots/p5-commit-trigger.png)

## 11. Deployment strategy

**Requirement:** rolling deployment with minimal downtime.

**Satisfied by:** the `RollingUpdate` strategy (`maxSurge: 1`, `maxUnavailable: 0`) in both Deployments, and readiness probes
that keep traffic away from pods that are not ready.

**Rolling update test (Test A):** see the result below.

![Pods replaced one at a time during a deploy](docs/screenshots/p8-A-pod-watch.png)
![Pipeline run that performed the update](docs/screenshots/p8-A-pipeline.png)
![New version visible on the site](docs/screenshots/p8-A-site-new-footer.png)
![Rollout history](docs/screenshots/p8-A-rollout-history.png)

## 12. Monitoring

**Requirement:** Prometheus and Grafana for CPU, memory, pod status, restarts, node health and application metrics.

**Satisfied by:** `kube-prometheus-stack` installed with Helm, [k8s/monitoring/servicemonitor.yaml](k8s/monitoring/servicemonitor.yaml)
(scrapes the backend's `/metrics`, plus two alert rules) and the custom dashboard
[k8s/monitoring/dashboard-blogapp-overview.json](k8s/monitoring/dashboard-blogapp-overview.json).

![CPU and memory per pod](docs/screenshots/p6-grafana-namespace.png)
![Node health](docs/screenshots/p6-grafana-nodes.png)
![Custom "Blog App Overview" dashboard](docs/screenshots/p6-grafana-custom.png)
![Application metrics in Explore](docs/screenshots/p6-grafana-app-metrics.png)
![Prometheus targets: backend up](docs/screenshots/p6-prom-targets.png)

## 13. Logging

**Requirement:** show logs from the frontend, backend, database and Kubernetes workloads, and find a problem with them.

**Satisfied by:** `kubectl logs` for each component.

**Finding a problem from logs:** `DB_HOST` was set to a host that does not exist and the backend restarted. The new pod stayed
`Running` but `0/1` ready while the two old pods kept serving (20 of 20 test requests returned `200`). The logs showed
`GET /readyz ... 503` from the probes, and the pod's own `/readyz` answer gave the cause:
`{"status":"not-ready","error":"getaddrinfo ENOTFOUND mysql-wrong"}`. The events showed
`Readiness probe failed: HTTP probe failed with statuscode: 503`. Restoring the setting and restarting fixed it.

![Frontend logs](docs/screenshots/p6-logs-frontend.png)
![Backend logs](docs/screenshots/p6-logs-backend.png)
![Database logs](docs/screenshots/p6-logs-mysql.png)
![Kubernetes system workload logs](docs/screenshots/p6-logs-kube-system.png)
![Diagnosing the wrong database host from logs and events](docs/screenshots/p6-dbhost-failure.png)

## 14. Security

| Control | How it is met | Screenshot |
| --- | --- | --- |
| IAM least privilege | Jenkins role limited to ECR push and `eks:DescribeCluster`; from the Jenkins server S3, EC2 and IAM calls are denied | [IAM policy](docs/screenshots/p7-iam-policy.png), [permission boundary](docs/screenshots/p7-jenkins-boundary.png) |
| Kubernetes RBAC | Jenkins has edit rights in `blogapp` only; the read-only `blog-viewer` role cannot change objects or read Secrets | [EKS access](docs/screenshots/p7-eks-access.png), [can-i results](docs/screenshots/p7-rbac-can-i.png) |
| Restricted network access | Default-deny NetworkPolicy; only the backend reaches MySQL; tool servers admit one IP and have no SSH port | [network tests](docs/screenshots/p7-netpol.png), [firewall rules](docs/screenshots/p7-sg-rules.png) |
| Secure database access | MySQL is a headless ClusterIP service behind the policy above | [network tests](docs/screenshots/p7-netpol.png) |
| Non-root containers | uid 1000, 101 and 999; no privilege escalation; all capabilities dropped | [id output](docs/screenshots/p7-nonroot.png) |
| Vulnerability scanning | Trivy gate in the pipeline plus ECR scan on push | [Trivy](docs/screenshots/p7-trivy-gate.png), [ECR scan](docs/screenshots/p7-ecr-scan.png) |
| Secure secrets management | Secrets come from Jenkins credentials and live as Kubernetes Secrets | [hidden values](docs/screenshots/p7-secrets-hidden.png) |
| No credentials in source code | History and tracked files contain no keys or `.env` files | [repository check](docs/screenshots/p7-git-grep.png) |

![IAM policy for the Jenkins role](docs/screenshots/p7-iam-policy.png)
![Jenkins permission boundary](docs/screenshots/p7-jenkins-boundary.png)
![EKS access entry limited to one namespace](docs/screenshots/p7-eks-access.png)
![RBAC checks](docs/screenshots/p7-rbac-can-i.png)
![Network policy tests](docs/screenshots/p7-netpol.png)
![Tool-server firewall](docs/screenshots/p7-sg-rules.png)
![Containers run as non-root](docs/screenshots/p7-nonroot.png)
![Trivy gate](docs/screenshots/p7-trivy-gate.png)
![ECR scan](docs/screenshots/p7-ecr-scan.png)
![Secrets do not show values](docs/screenshots/p7-secrets-hidden.png)
![Repository contains no credentials](docs/screenshots/p7-git-grep.png)
