from django.http import JsonResponse
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')

    if not username or not password:
        return Response({'error': 'Username and password are required'}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(username=username, password=password)
    if not user:
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)

    refresh = RefreshToken.for_user(user)
    return Response({
        'tokens': {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        },
        'user': {
            'username': user.username,
            'email': user.email,
            'is_staff': user.is_staff,
        },
    })


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def logout_view(request):
    refresh_token = request.data.get('refresh')
    if not refresh_token:
        return Response(
            {'error': 'Refresh token is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        RefreshToken(refresh_token).blacklist()
    except TokenError:
        return Response(
            {'error': 'Invalid refresh token'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response({'message': 'Logged out successfully'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_info(request):
    user = request.user
    return Response({
        'username': user.username,
        'email': user.email,
        'is_staff': user.is_staff,
    })


def api_not_found(request, *args, **kwargs):
    return JsonResponse({'error': 'Not found'}, status=404)
