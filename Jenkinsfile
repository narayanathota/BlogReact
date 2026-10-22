// CI/CD for the Blog App on Amazon EKS
// Checkout -> Build -> Test -> SonarQube + Quality Gate -> Docker Build -> Trivy -> Versioning
//   -> Nexus -> ECR -> EKS Deployment -> Validation (automatic rollback if a deployed build fails)

def sonarScan(String appDir, String projectKey, String extra = '') {
  dir(appDir) {
    withSonarQubeEnv('sonarqube-server') {
      sh "sonar-scanner -Dsonar.projectKey=${projectKey} -Dsonar.sources=src ${extra} " +
         "-Dsonar.exclusions=**/node_modules/**,**/coverage/** " +
         "-Dsonar.javascript.lcov.reportPaths=coverage/lcov.info"
    }
  }
  // blocks the pipeline until SonarQube reports the Quality Gate result via its webhook
  timeout(time: 10, unit: 'MINUTES') {
    waitForQualityGate abortPipeline: true
  }
}

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  // GitHub cannot reach this Jenkins (its firewall only allows the admin IP), so Jenkins asks GitHub for new commits.
  triggers { pollSCM('H/2 * * * *') }

  environment {
    AWS_REGION     = 'ap-south-1'
    AWS_ACCOUNT_ID = '172202858858'
    ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    NEXUS_REGISTRY = '192.168.52.165:8083'
    CLUSTER_NAME   = 'blogapp-eks-cluster'
    NAMESPACE      = 'blogapp'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          // unique, traceable image version: <build number>-<git commit>
          def sha = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${sha}"
        }
        echo "Image tag for this build: ${env.IMAGE_TAG}"
      }
    }

    stage('Build') {
      parallel {
        stage('Backend dependencies') { steps { dir('backend')  { sh 'npm ci' } } }
        stage('Frontend build')       { steps { dir('frontend') { sh 'npm ci && npm run build' } } }
      }
    }

    stage('Test') {
      steps { dir('backend') { sh 'npm test' } }
    }

    stage('SonarQube + Quality Gate: Backend') {
      steps { script { sonarScan('backend', 'blogapp-backend', '-Dsonar.tests=tests') } }
    }

    stage('SonarQube + Quality Gate: Frontend') {
      steps { script { sonarScan('frontend', 'blogapp-frontend') } }
    }

    stage('Docker Build') {
      steps {
        sh '''
          docker build -t blogapp-backend:$IMAGE_TAG backend/
          docker build --build-arg VITE_API_URL=/api -t blogapp-frontend:$IMAGE_TAG frontend/
        '''
      }
    }

    stage('Trivy Scan') {
      steps {
        // fails the build on any fixable HIGH or CRITICAL vulnerability; both images are scanned before failing
        sh '''
          mkdir -p trivy-reports
          rc=0
          for app in backend frontend; do
            trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 \
              --format table -o trivy-reports/$app.txt blogapp-$app:$IMAGE_TAG || rc=1
            cat trivy-reports/$app.txt
          done
          exit $rc
        '''
      }
      post { always { archiveArtifacts artifacts: 'trivy-reports/*', allowEmptyArchive: true } }
    }

    stage('Image Versioning') {
      steps {
        sh '''
          for app in backend frontend; do
            docker tag blogapp-$app:$IMAGE_TAG $ECR_REGISTRY/blogapp-$app:$IMAGE_TAG
            docker tag blogapp-$app:$IMAGE_TAG $NEXUS_REGISTRY/blogapp-$app:$IMAGE_TAG
          done
        '''
      }
    }

    stage('Push to Nexus') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'nexus-creds',
                         usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
          sh '''
            echo "$NEXUS_PASS" | docker login $NEXUS_REGISTRY -u "$NEXUS_USER" --password-stdin
            docker push $NEXUS_REGISTRY/blogapp-backend:$IMAGE_TAG
            docker push $NEXUS_REGISTRY/blogapp-frontend:$IMAGE_TAG
            docker logout $NEXUS_REGISTRY
          '''
        }
      }
    }

    stage('Push to ECR') {
      steps {
        // uses the Jenkins server's IAM role: no AWS keys are stored anywhere
        sh '''
          aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
          docker push $ECR_REGISTRY/blogapp-backend:$IMAGE_TAG
          docker push $ECR_REGISTRY/blogapp-frontend:$IMAGE_TAG
          docker logout $ECR_REGISTRY
        '''
      }
    }

    stage('EKS Deployment') {
      steps {
        withCredentials([
          string(credentialsId: 'db-password',         variable: 'DB_PASSWORD'),
          string(credentialsId: 'mysql-root-password', variable: 'MYSQL_ROOT_PASSWORD'),
          string(credentialsId: 'jwt-secret',          variable: 'JWT_SECRET')
        ]) {
          sh '''
            aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION

            # the Kubernetes Secret is built from Jenkins credentials at deploy time; it is never stored in Git
            kubectl create secret generic blogapp-secrets -n $NAMESPACE \
              --from-literal=DB_PASSWORD="$DB_PASSWORD" \
              --from-literal=MYSQL_PASSWORD="$DB_PASSWORD" \
              --from-literal=MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
              --from-literal=JWT_SECRET="$JWT_SECRET" \
              --dry-run=client -o yaml | kubectl apply -f -

            kubectl create configmap mysql-init-script -n $NAMESPACE \
              --from-file=init.sql=database/init.sql --dry-run=client -o yaml | kubectl apply -f -

            # render the manifests with this build's image versions (the rendered copy is not committed)
            rm -rf rendered && cp -r k8s/app rendered
            sed -i "s#IMAGE_BACKEND#$ECR_REGISTRY/blogapp-backend:$IMAGE_TAG#"   rendered/backend.yaml
            sed -i "s#IMAGE_FRONTEND#$ECR_REGISTRY/blogapp-frontend:$IMAGE_TAG#" rendered/frontend.yaml
            kubectl apply -R -f rendered/
          '''
          script { env.DEPLOYED = 'true' }
        }
      }
    }

    stage('Deployment Validation') {
      steps {
        sh '''
          kubectl rollout status deployment/backend  -n $NAMESPACE --timeout=240s
          kubectl rollout status deployment/frontend -n $NAMESPACE --timeout=240s
          kubectl get pods -n $NAMESPACE -o wide
          HOST=$(kubectl get ingress blogapp-ingress -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
          echo "Application URL: http://$HOST"
          for i in $(seq 1 20); do
            if curl -sf http://$HOST/ >/dev/null && curl -sf http://$HOST/api/posts >/dev/null; then
              echo "Smoke test passed"; exit 0
            fi
            sleep 15
          done
          echo "Smoke test failed"; exit 1
        '''
      }
    }
  }

  post {
    failure {
      script {
        // roll back only if this build had already changed the cluster
        if (env.DEPLOYED == 'true') {
          sh 'kubectl rollout undo deployment/backend -n $NAMESPACE || true; kubectl rollout undo deployment/frontend -n $NAMESPACE || true'
        }
      }
    }
    always { sh 'docker image prune -f || true' }
  }
}
